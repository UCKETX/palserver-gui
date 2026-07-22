import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { DATA_DIR } from "./env.js";

/**
 * 配置評估健檢(進階顯示/贊助者):收集這台主機的硬體與網路狀況,
 * 用「開帕魯專用伺服器」的需求給逐項評級與總分。
 *
 * 設計原則:
 * - 規則評分完全在本機完成(離線可用,不外送任何資料)。
 * - 磁碟不猜 SSD/HDD 型號,直接實測寫入速度(64MB 到 DATA_DIR,存檔就住這顆碟)。
 * - 網路量不到玩家到主機的 UDP 品質,用對外 TCP 連線 RTT/抖動當代理指標,誠實標示。
 */

export type Rating = "good" | "ok" | "poor";

export interface SystemSpecs {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  /** os.cpus() 回報的時脈(MHz);部分平台拿不到就是 0。 */
  cpuSpeedMHz: number;
  ramTotalBytes: number;
  ramFreeBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  /** 實測循序寫入(MB/s),寫在 DATA_DIR 所在磁碟。 */
  diskWriteMBps: number;
  /** 對外 TCP 443 連線 RTT(ms):取多個端點多次採樣。 */
  netAvgMs: number | null;
  netMinMs: number | null;
  /** RTT 抖動(樣本標準差,ms)。 */
  netJitterMs: number | null;
}

export interface DimensionReview {
  rating: Rating;
  /** 前端顯示用的主要數值(已格式化交給前端做,這裡給原始)。 */
  score: number;
}

export interface SystemReview {
  specs: SystemSpecs;
  ram: DimensionReview;
  cpu: DimensionReview;
  disk: DimensionReview;
  network: DimensionReview;
  /** 加權總分:100 = 剛好滿足需求;可高於 100(硬體超出需求)或低於 100(不足)。 */
  overall: number;
  /** 計分依據的伺服器數(建立的實例數,至少 1);越多所需規格越高、未達標就扣分。 */
  serverCount: number;
  generatedAt: string;
}

/** 實測循序寫入速度:64MB 寫進 DATA_DIR 再刪掉。存檔與伺服器檔案就住這顆碟,
 *  比猜磁碟型號誠實;HDD 通常 <150MB/s、SATA SSD ~300-500、NVMe >1000。 */
async function measureDiskWrite(): Promise<number> {
  const file = path.join(DATA_DIR, `.disk-bench-${crypto.randomBytes(4).toString("hex")}`);
  const chunk = crypto.randomBytes(4 * 1024 * 1024); // 4MB 亂數塊,避開壓縮/快取美化
  const chunks = 16; // 共 64MB
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const started = process.hrtime.bigint();
    const fd = fs.openSync(file, "w");
    for (let i = 0; i < chunks; i++) fs.writeSync(fd, chunk);
    fs.fsyncSync(fd); // 逼出 OS 寫入快取,量到的才是磁碟
    fs.closeSync(fd);
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    return Math.round(((chunks * chunk.length) / (1 << 20)) / seconds);
  } catch {
    return 0;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 一次 TCP 連線的 RTT(ms);逾時/失敗回 null。 */
function tcpRtt(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (v: number | null) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(null));
    sock.once("connect", () => done(Number(process.hrtime.bigint() - started) / 1e6));
    sock.once("error", () => done(null));
  });
}

/** 對外連線品質:兩個端點各 4 次採樣(丟掉第一次的 DNS/暖機失真)。 */
async function measureNetwork(): Promise<{ avg: number | null; min: number | null; jitter: number | null }> {
  const hosts: [string, number][] = [
    ["api.steampowered.com", 443], // 與遊戲生態相關的實際端點
    ["www.google.com", 443],
  ];
  const samples: number[] = [];
  for (const [host, port] of hosts) {
    await tcpRtt(host, port); // 暖機(DNS/連線快取),不計入
    for (let i = 0; i < 4; i++) {
      const v = await tcpRtt(host, port);
      if (v !== null) samples.push(v);
    }
  }
  if (samples.length === 0) return { avg: null, min: null, jitter: null };
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const jitter = Math.sqrt(samples.reduce((a, b) => a + (b - avg) ** 2, 0) / samples.length);
  return { avg: Math.round(avg * 10) / 10, min: Math.round(min * 10) / 10, jitter: Math.round(jitter * 10) / 10 };
}

export async function collectSpecs(): Promise<SystemSpecs> {
  const cpus = os.cpus();
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const st = fs.statfsSync(DATA_DIR);
    diskTotal = st.blocks * st.bsize;
    diskFree = st.bavail * st.bsize;
  } catch {
    /* 平台不支援 statfs 就留 0,前端顯示 — */
  }
  const [diskWriteMBps, netStats] = await Promise.all([measureDiskWrite(), measureNetwork()]);
  return {
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    cpuCores: cpus.length,
    cpuSpeedMHz: cpus[0]?.speed ?? 0,
    ramTotalBytes: os.totalmem(),
    ramFreeBytes: os.freemem(),
    diskTotalBytes: diskTotal,
    diskFreeBytes: diskFree,
    diskWriteMBps,
    netAvgMs: netStats.avg,
    netMinMs: netStats.min,
    netJitterMs: netStats.jitter,
  };
}

/** 比值(實際/需求)→ 分數:
 *  達標(ratio≥1)給 100 起,超出有遞減加成、封頂 150(1.5×≈120、6×≈150);
 *  未達標(ratio<1)線性往下扣到 0(半數→50)。這讓「超常表現」能顯示如 121/100。 */
function scoreFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return ratio >= 1
    ? Math.round(100 + Math.min(50, 60 * (1 - 1 / ratio)))
    : Math.round(100 * ratio);
}

/** 分數 → 評級(前端配色用):100+ 充裕、60+ 夠用、其餘吃緊。 */
function ratingOf(score: number): Rating {
  return score >= 100 ? "good" : score >= 60 ? "ok" : "poor";
}

/**
 * 規則評分:需求依「伺服器數」(serverCount,至少 1)放大 —— 每多一台伺服器,
 * RAM / CPU 核 / 磁碟空間 / 寫入速度的需求都往上加;未達標會扣分,硬體超出需求則
 * 分數高於 100(封頂 150)。同時運行越多台 → 需求越高 → 規格不夠分數就低。
 */
export function reviewSpecs(specs: SystemSpecs, serverCount = 1): SystemReview {
  const gb = (n: number) => n / (1 << 30);
  const n = Math.max(1, Math.floor(serverCount) || 1);

  // RAM:單台約吃 8-12GB,外加系統/GUI 基本盤。需求 = 8 + 8·N GB(1台→16、2台→24、3台→32)。
  const ramScore = scoreFromRatio(gb(specs.ramTotalBytes) / (8 + 8 * n));

  // CPU:tick 吃單核(時脈),並發吃核心數。有效核心 = 核心數 × 時脈係數(0.65-1.3);需求 = 2 + 2·N 核。
  const speedFactor = specs.cpuSpeedMHz > 0 ? Math.min(1.3, Math.max(0.65, specs.cpuSpeedMHz / 3200)) : 1;
  const cpuScore = scoreFromRatio((specs.cpuCores * speedFactor) / (2 + 2 * n));

  // 磁碟:空間(安裝+備份)與循序寫入(自動備份)取較差者當瓶頸;量不到的那項不懲罰(視為足夠)。
  //   空間需求 = 15 + 25·N GB;寫入需求 = 120 + 40·N MB/s。
  const diskSpaceRatio = specs.diskTotalBytes > 0 ? gb(specs.diskFreeBytes) / (15 + 25 * n) : Infinity;
  const diskSpeedRatio = specs.diskWriteMBps > 0 ? specs.diskWriteMBps / (120 + 40 * n) : Infinity;
  const diskScore = scoreFromRatio(Math.min(diskSpaceRatio, diskSpeedRatio));

  // 網路:對外 RTT/抖動代理(不隨 N 變);量不到(離線/防火牆)給中性 100,不懲罰。
  const netScore =
    specs.netAvgMs === null
      ? 100
      : scoreFromRatio(Math.min(60 / specs.netAvgMs, 25 / Math.max(1, specs.netJitterMs ?? 0)));

  const overall = Math.round(ramScore * 0.35 + cpuScore * 0.3 + diskScore * 0.2 + netScore * 0.15);

  return {
    specs,
    ram: { rating: ratingOf(ramScore), score: ramScore },
    cpu: { rating: ratingOf(cpuScore), score: cpuScore },
    disk: { rating: ratingOf(diskScore), score: diskScore },
    network: { rating: ratingOf(netScore), score: netScore },
    overall,
    serverCount: n,
    generatedAt: new Date().toISOString(),
  };
}
