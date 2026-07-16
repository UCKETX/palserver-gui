import { useCallback, useEffect, useState } from "react";
import { FiAward, FiBookOpen, FiDollarSign, FiHome, FiRefreshCw, FiTrendingUp, FiZap } from "react-icons/fi";
import type { SaveScanStats, SaveScanPlayerStat } from "@palserver/shared";
import type { AgentClient } from "./api";
import { displayName, palIconUrl, useGameData, type GameData } from "./gameData";
import { t, useI18n } from "./i18n";
import { btnGhost, card, errorCls } from "./ui";

/**
 * 排行榜分頁 — 存檔掃描統計歷史(save-stats-history)驅動。
 * 榜單吃最新一筆掃描;有前一筆時加「與上次掃描相比」週報區。
 * 不依賴 PalDefender。
 */
export function LeaderboardTab({ client, instanceId }: { client: AgentClient; instanceId: string }) {
  useI18n();
  const gameData = useGameData();
  const [worldGuid, setWorldGuid] = useState<string | null>(null);
  const [history, setHistory] = useState<SaveScanStats[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canScan, setCanScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.statsHistory(instanceId);
      setWorldGuid(res.worldGuid);
      setHistory(res.history);
      setNote(null);
      try {
        const health = await client.saveHealth(instanceId, res.worldGuid);
        setCanScan(health.supported);
        if (!health.supported) setNote(health.reason ?? t("此主機不支援存檔掃描"));
      } catch {
        setCanScan(false);
      }
    } catch (err) {
      setCanScan(false);
      setNote(t("無法取得存檔快照:{reason}", { reason: err instanceof Error ? err.message : String(err) }));
    }
  }, [client, instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    if (!worldGuid) return;
    setError(null);
    setScanning(true);
    try {
      await client.startSaveHealth(instanceId, worldGuid);
      await new Promise<void>((resolve) => {
        const timer = setInterval(async () => {
          try {
            const s = await client.saveHealth(instanceId, worldGuid);
            if (s.phase === "idle") {
              clearInterval(timer);
              if (s.error) setError(s.error);
              resolve();
            }
          } catch {
            /* 暫時性網路錯誤:下一輪再試 */
          }
        }, 2000);
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const latest = history && history.length > 0 ? history[history.length - 1] : null;
  const prev = history && history.length > 1 ? history[history.length - 2] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          {latest
            ? t("資料來自存檔掃描(掃描於 {when})。", { when: new Date(latest.scannedAt).toLocaleString() })
            : t("尚未掃描過存檔。點「從存檔刷新」建立快照。")}
        </p>
        {canScan && (
          <button
            className={`${btnGhost} inline-flex items-center gap-1.5`}
            onClick={() => void scan()}
            disabled={scanning}
          >
            <FiRefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? t("掃描存檔中…(依存檔大小可能需要幾分鐘)") : t("從存檔刷新")}
          </button>
        )}
      </div>

      {error && <p className={errorCls}>{error}</p>}
      {note && !scanning && <p className="text-[13px] text-ink-muted">{note}</p>}

      {latest && (
        <>
          {prev ? (
            <WeeklyReport latest={latest} prev={prev} />
          ) : (
            <p className="text-[13px] text-ink-muted">
              {t("再掃描一次就會有「與上次掃描相比」的變化報告(以兩次掃描為比較基準)。")}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Board
              icon={<FiTrendingUp className="size-4 text-pal" />}
              title={t("等級榜")}
              hint={t("玩家等級(掃描當下);+n 為與上次掃描相比的成長")}
              rows={topBy(latest.players.filter((p) => p.level !== null), (p) => p.level ?? -1).map((p) => ({
                key: p.uid,
                avatar: <PlayerAvatar seed={p.uid} gameData={gameData} />,
                name: p.name,
                value: `Lv.${p.level}`,
                delta: levelDelta(p, prev),
              }))}
            />
            <Board
              icon={<FiDollarSign className="size-4 text-pal" />}
              title={t("財富榜")}
              hint={t("金幣(含離線背包);解析不到金錢的玩家不列入")}
              rows={topBy(latest.players.filter((p) => p.money !== null), (p) => p.money ?? -1).map((p) => ({
                key: p.uid,
                avatar: <PlayerAvatar seed={p.uid} gameData={gameData} />,
                name: p.name,
                value: (p.money ?? 0).toLocaleString(),
              }))}
            />
            <Board
              icon={<FiBookOpen className="size-4 text-pal" />}
              title={t("圖鑑收集榜")}
              hint={t("圖鑑已登錄或捕捉過的物種數 / 全部物種")}
              rows={topBy(latest.players.filter((p) => p.paldeckCount !== null), (p) => p.paldeckCount ?? -1).map(
                (p) => ({
                  key: p.uid,
                  avatar: <PlayerAvatar seed={p.uid} gameData={gameData} />,
                  name: p.name,
                  value: paldeckLabel(p.paldeckCount ?? 0, gameData),
                }),
              )}
            />
            <Board
              icon={<FiZap className="size-4 text-pal" />}
              title={t("最強帕魯榜")}
              hint={t("每位玩家最強的一隻:等級 → 個體值總和 → 星級")}
              rows={topBy(latest.players.filter((p) => p.topPal), (p) => topPalKey(p)).map((p) => ({
                key: p.uid,
                avatar: <PalFace p={p} gameData={gameData} />,
                name: palLabel(p, gameData),
                value: t("Lv.{lv} · IV {iv} · 主人 {name}", {
                  lv: p.topPal?.level ?? "—",
                  iv: p.topPal?.ivTotal ?? 0,
                  name: p.name,
                }),
              }))}
            />
            <Board
              icon={<FiHome className="size-4 text-pal" />}
              title={t("公會榜")}
              hint={t("依成員數排序")}
              rows={topBy(latest.guilds, (g) => g.memberCount).map((g) => ({
                key: g.id,
                name: g.name,
                value: `${t("{n} 名成員", { n: g.memberCount })} · ${t("{n} 個據點", { n: g.baseCount })}`,
              }))}
            />
          </div>
        </>
      )}

      {history && history.length === 0 && (
        <div className="rounded-cute border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">
          <FiAward className="mx-auto mb-2 size-11" />
          {t("還沒有排行榜資料。掃描一次存檔就會出現(掃描也會更新健檢與玩家/公會快照)。")}
        </div>
      )}
    </div>
  );
}

/* ── 頭像:與玩家清單同一套「以 id 雜湊固定選一隻帕魯臉」(帕魯世界沒有玩家頭像) ── */

function PlayerAvatar({ seed, gameData, size = 24 }: { seed: string; gameData: GameData | null; size?: number }) {
  const withIcons = gameData?.pals.filter((p) => p.icon) ?? [];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const pal = withIcons.length ? withIcons[hash % withIcons.length] : null;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-line bg-card-soft"
      style={{ width: size, height: size }}
    >
      {pal?.icon ? <img src={palIconUrl(pal.icon)} alt="" className="size-full object-cover" /> : null}
    </span>
  );
}

/** 最強帕魯榜用:該物種的真實圖示;目錄查不到就退回玩家頭像。 */
function PalFace({ p, gameData, size = 24 }: { p: SaveScanPlayerStat; gameData: GameData | null; size?: number }) {
  const species = p.topPal
    ? gameData?.palByIdLower.get(p.topPal.characterId.replace(/^boss_/i, "").toLowerCase())
    : undefined;
  if (!species?.icon) return <PlayerAvatar seed={p.uid} gameData={gameData} size={size} />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-line bg-card-soft"
      style={{ width: size, height: size }}
    >
      <img src={palIconUrl(species.icon)} alt="" className="size-full object-cover" />
    </span>
  );
}

/* ── 榜單資料整理 ── */

function topBy<T>(list: T[], key: (x: T) => number, n = 10): T[] {
  return [...list].sort((a, b) => key(b) - key(a)).slice(0, n);
}

/** 最強帕魯排序鍵:等級 → IV 總和 → 星級(與 agent 端 computeScanStats 同規則)。 */
function topPalKey(p: SaveScanPlayerStat): number {
  const tp = p.topPal;
  if (!tp) return -1;
  return (tp.level ?? 0) * 1_000_000 + tp.ivTotal * 100 + (tp.rank ?? 0);
}

function levelDelta(p: SaveScanPlayerStat, prev: SaveScanStats | null): string | undefined {
  const before = prev?.players.find((x) => x.uid === p.uid);
  if (!before || before.level === null || p.level === null) return undefined;
  const d = p.level - before.level;
  return d > 0 ? `+${d}` : undefined;
}

function paldeckLabel(count: number, gameData: GameData | null): string {
  const total = gameData?.pals.length ?? 0;
  if (total > 0) {
    const pct = Math.min(100, Math.round((count / total) * 100));
    return `${count} / ${total}(${pct}%)`;
  }
  return String(count);
}

function palLabel(p: SaveScanPlayerStat, gameData: GameData | null): string {
  const tp = p.topPal;
  if (!tp) return "—";
  const species = gameData?.palByIdLower.get(tp.characterId.replace(/^boss_/i, "").toLowerCase());
  const base = species ? displayName(species) : tp.characterId;
  const star = tp.rank !== null && tp.rank > 1 ? ` ★${tp.rank - 1}` : "";
  return tp.nickname ? `${tp.nickname}(${base})${star}` : `${base}${star}`;
}

/* ── 週報:與上次掃描相比 ── */

function WeeklyReport({ latest, prev }: { latest: SaveScanStats; prev: SaveScanStats }) {
  const prevUids = new Set(prev.players.map((p) => p.uid));
  const newPlayers = latest.players.filter((p) => !prevUids.has(p.uid));
  const prevGuilds = new Set(prev.guilds.map((g) => g.id));
  const newGuilds = latest.guilds.filter((g) => !prevGuilds.has(g.id));

  const gains = latest.players
    .map((p) => {
      const before = prev.players.find((x) => x.uid === p.uid);
      return before && before.level !== null && p.level !== null
        ? { name: p.name, delta: p.level - before.level }
        : null;
    })
    .filter((x): x is { name: string; delta: number } => x !== null && x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const moneyNow = latest.players.reduce((s, p) => s + (p.money ?? 0), 0);
  const moneyBefore = prev.players.reduce((s, p) => s + (p.money ?? 0), 0);
  const moneyDelta = moneyNow - moneyBefore;

  const items: string[] = [];
  if (newPlayers.length > 0) {
    items.push(t("新玩家 {n} 位:{names}", { n: newPlayers.length, names: newPlayers.map((p) => p.name).join("、") }));
  }
  if (gains.length > 0) {
    items.push(
      t("等級成長最多:{list}", { list: gains.map((g) => `${g.name}(+${g.delta})`).join("、") }),
    );
  }
  if (newGuilds.length > 0) {
    items.push(t("新公會:{names}", { names: newGuilds.map((g) => g.name).join("、") }));
  }
  if (moneyDelta !== 0) {
    items.push(
      t("全服金錢 {sign}{n}", { sign: moneyDelta > 0 ? "+" : "-", n: Math.abs(moneyDelta).toLocaleString() }),
    );
  }

  return (
    <div className={`${card} flex flex-col gap-2`}>
      <p className="text-sm font-extrabold">
        {t("與上次掃描相比({when})", { when: new Date(prev.scannedAt).toLocaleString() })}
      </p>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-muted">{t("這段期間伺服器沒有明顯變化。")}</p>
      )}
    </div>
  );
}

/* ── 榜單卡片 ── */

function Board({
  icon,
  title,
  hint,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  /** 榜單規則一句話(顯示在標題下) */
  hint?: string;
  rows: { key: string; name: string; value: string; delta?: string; avatar?: React.ReactNode }[];
}) {
  return (
    <div className={`${card} flex flex-col gap-2`}>
      <div>
        <p className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-muted">
          {icon} {title}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-ink-muted/80">{hint}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{t("沒有資料")}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 text-[13px]">
              <span
                className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  i === 0 ? "bg-sun/25 text-sun" : i < 3 ? "bg-pal/15 text-pal" : "bg-card-soft text-ink-muted"
                }`}
              >
                {i + 1}
              </span>
              {r.avatar}
              <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
              {r.delta && <span className="shrink-0 text-xs font-extrabold text-pal">{r.delta}</span>}
              <span className="shrink-0 font-mono text-xs text-ink-muted">{r.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
