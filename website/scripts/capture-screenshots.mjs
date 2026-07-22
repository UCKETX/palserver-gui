#!/usr/bin/env node
/**
 * 對「正在運行的 palserver GUI」截圖,產生官網各語言介面截圖。
 * 需要一個可連的 agent(最好是有跑起來的 demo 實例、且支援模組的 Windows 機器,
 * 這樣 engine/mods 才有內容)。用 playwright 驅動,自動切語言、開分頁、截 1320 寬。
 *
 *   AGENT_URL=http://127.0.0.1:8250 AGENT_TOKEN=xxx \
 *     node scripts/capture-screenshots.mjs [screens...] [--langs=en,ja]
 *
 * screens 可選:login announcement engine mods create saves connect(預設 login/announcement/engine/mods/create)。
 * loopback(127.0.0.1)免 token;tailnet/遠端要帶 AGENT_TOKEN(= 你瀏覽器配對過的長 token)。
 * connect 需要 agent 上「至少有一個 running 的實例」(不會自己挑第一張卡,而是找 status===running 的那個)。
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = process.env.OUT_DIR || path.resolve(HERE, "../public/assets");
const AGENT = process.env.AGENT_URL || "http://127.0.0.1:8250";
const TOKEN = process.env.AGENT_TOKEN || "";
// APP_URL = App 本身的位址(可跟 agent 不同,例如 vite dev localhost:5173 連本機 agent)。
const APP = process.env.APP_URL || AGENT;
const W = 1320;

const argv = process.argv.slice(2);
const langArg = argv.find((a) => a.startsWith("--langs="));
const LANGS = langArg ? langArg.slice(8).split(",") : ["en", "ja"];
const screens = argv.filter((a) => !a.startsWith("--"));
const WANT = screens.length ? screens : ["login", "announcement", "engine", "mods", "create"];

const CONN = JSON.stringify({ url: AGENT, token: TOKEN });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 與既有截圖同框:1320 寬,分頁頁面 848 高、連線/公告 984 高、建立伺服器精靈 1012(視窗裁切,非整頁)。
const HEIGHTS = { login: 984, announcement: 984, engine: 848, mods: 848, create: 1012, saves: 848, connect: 848 };

async function shot(page, lang, name) {
  await page.setViewportSize({ width: W, height: HEIGHTS[name] || 848 });
  await sleep(400);
  const out = path.join(ASSETS, lang, name + ".jpg");
  await page.screenshot({ path: out, type: "jpeg", quality: 92, fullPage: false });
  console.log("wrote", lang + "/" + name + ".jpg");
}

/** 新 context:注入語言;connected 時注入連線;markSeen 時把公告標為已看(略過彈窗)。 */
async function ctxFor(browser, lang, connected, markSeen) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ([lang, conn, connected, markSeen, seen]) => {
      localStorage.setItem("palserver.lang", lang);
      if (connected) {
        localStorage.setItem("palserver.connection", conn);
        if (markSeen) localStorage.setItem("palserver.announcementsSeen", seen);
        else localStorage.removeItem("palserver.announcementsSeen");
      } else {
        localStorage.removeItem("palserver.connection");
      }
    },
    [lang, CONN, connected, markSeen, JSON.stringify(["2026-07-welcome-2-0", "2026-07-10-palguard-1-0"])],
  );
  return ctx;
}

/** 逐則點掉公告彈窗,避免擋住導覽。公告彈窗是 AnnouncementModal 的 `.z-40` 容器
 *  (全站唯一用這個 z-index),按文字比對法語系一多就會漏,改成結構選取:
 *  只要 `.z-40` 還在就點裡面唯一的主按鈕(下一則/我知道了),直到彈窗消失。 */
async function dismissAnnounce(page) {
  for (let i = 0; i < 8; i++) {
    const overlay = page.locator(".z-40");
    if (!(await overlay.count().then((c) => c > 0).catch(() => false))) break;
    await overlay.locator("button").first().click().catch(() => {});
    await sleep(300);
  }
}

async function openInstanceTab(page, tab) {
  await page.waitForSelector(".grid button, [data-testid='create-server']", { timeout: 15000 });
  const cards = page.locator(".grid button").filter({ has: page.locator("strong") });
  await cards.first().click();
  await page.waitForSelector("[data-tab='" + tab + "']", { timeout: 15000 });
  await page.locator("[data-tab='" + tab + "']").click();
  await sleep(1200);
}

/** 開指定「名稱」的伺服器卡(而非隨便選第一張),用於機器上有很多測試實例、
 *  需要精準挑中某一台(例如唯一 running 的那台)時。 */
async function openInstanceByName(page, name) {
  await page.waitForSelector(".grid button, [data-testid='create-server']", { timeout: 15000 });
  const card = page.locator(".grid button").filter({ has: page.locator("strong", { hasText: name }) });
  await card.first().click();
  await page.waitForSelector("[data-tab='overview']", { timeout: 15000 });
  await sleep(1200);
}

/** 查 agent 上目前 status === "running" 的第一個實例(connect screen 需要一台真的在跑的伺服器,
 *  ConnectionCard 才有意義)。找不到就丟錯,main() 會印出來並中止,不瞎猜第一張卡。 */
async function findRunningInstance() {
  const headers = TOKEN ? { Authorization: "Bearer " + TOKEN } : {};
  const res = await fetch(AGENT + "/api/instances", { headers });
  if (!res.ok) throw new Error("GET /api/instances failed: " + res.status);
  const list = await res.json();
  const running = list.find((i) => i.status === "running");
  if (!running) throw new Error("agent 上沒有 status===running 的實例,connect screen 需要至少一台真的在跑的伺服器");
  return running;
}

async function main() {
  const browser = await chromium.launch();
  // connect screen 要求「一定要有真的 running 中的伺服器」,查一次就好、四語共用同一台。
  const runningInstance = WANT.includes("connect") ? await findRunningInstance() : null;
  if (runningInstance) console.log("connect screen 用實例:", runningInstance.name, runningInstance.id);
  for (const lang of LANGS) {
    if (WANT.includes("login")) {
      const ctx = await ctxFor(browser, lang, false, false);
      const page = await ctx.newPage();
      // ?setup 強制顯示「第一次連線」畫面(需純網頁版 App,agent 同源會自動連線跳過)。
      await page.goto(APP + "/?setup", { waitUntil: "domcontentloaded" });
      await sleep(1800);
      await shot(page, lang, "login");
      await ctx.close();
    }
    if (WANT.includes("announcement")) {
      // 連線但不標已看 → 公告彈窗會自動跳(內文依語言 filter)。
      const ctx = await ctxFor(browser, lang, true, false);
      const page = await ctx.newPage();
      // 擋掉 GitHub 遠端公告(可能還是舊版沒傳播),強制用本機最新的 /announcement.md。
      await page.route("**/raw.githubusercontent.com/**", (r) => r.abort());
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(3000); // 等公告載入 + 彈窗出現
      await shot(page, lang, "announcement");
      await ctx.close();
    }
    if (WANT.includes("engine") || WANT.includes("mods") || WANT.includes("saves")) {
      const ctx = await ctxFor(browser, lang, true, true);
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(1800);
      await dismissAnnounce(page);
      if (WANT.includes("engine")) {
        await openInstanceTab(page, "engine");
        await shot(page, lang, "engine");
      }
      if (WANT.includes("mods")) {
        await page.goto(APP, { waitUntil: "domcontentloaded" });
        await sleep(1200);
        await dismissAnnounce(page);
        await openInstanceTab(page, "mods");
        await shot(page, lang, "mods");
      }
      if (WANT.includes("saves")) {
        await page.goto(APP, { waitUntil: "domcontentloaded" });
        await sleep(1200);
        await dismissAnnounce(page);
        await openInstanceTab(page, "saves");
        await shot(page, lang, "saves");
      }
      await ctx.close();
    }
    if (WANT.includes("create")) {
      // 首頁「建立伺服器」精靈:不需要既有實例,直接從首頁點開即可。
      const ctx = await ctxFor(browser, lang, true, true);
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(1500);
      await dismissAnnounce(page);
      await page.waitForSelector("[data-testid='create-server']", { timeout: 15000 });
      await page.locator("[data-testid='create-server']").click();
      await page.waitForSelector(".z-50", { timeout: 15000 }); // Overlay 的彈窗容器
      await sleep(500);
      await shot(page, lang, "create");
      await ctx.close();
    }
    if (WANT.includes("connect")) {
      // 「邀請朋友加入」卡(ConnectionCard)在該實例 Overview 頁的連線方式三選一預設 playit,
      // 但每實例會記在 localStorage palserver.connMethod.<instanceId>,之前手動截圖時被切成
      // 過 vpn 就會卡住。這裡在 context 建立時就把該實例的 key 直接寫成 "playit",
      // 再保險地在畫面上點一次 playit 卡確保萬無一失(萬一 addInitScript 因故沒吃到)。
      const ctx = await ctxFor(browser, lang, true, true);
      await ctx.addInitScript((id) => {
        localStorage.setItem("palserver.connMethod." + id, "playit");
      }, runningInstance.id);
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await sleep(1500);
      await dismissAnnounce(page);
      await openInstanceByName(page, runningInstance.name);
      // ConnectionCard 要等 client.connection(instanceId) 這支 REST 打完才會從 null 變成真的內容
      // (跨 tailnet 有時比較慢),固定 sleep 賭不準,改成等按鈕真的出現。
      const playitBtn = page.locator("button", { hasText: "playit.gg" }).first();
      await playitBtn.waitFor({ state: "visible", timeout: 10000 });
      await playitBtn.click().catch(() => {});
      await sleep(500);
      await shot(page, lang, "connect");
      await ctx.close();
    }
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
