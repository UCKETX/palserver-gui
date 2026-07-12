#!/usr/bin/env node
/**
 * 抓「詞條(被動)」與「主動技」目錄,給指令台的自訂帕魯選單用。
 *
 * 資料來源(維護者為貢獻者,已獲同意;見 public/game-data/CREDITS.md):
 *  - 詞條:paldeck.cc/passives —— Next.js 串流資料裡有 {Asset(內部 id), Name, Rank}。
 *    Asset 就是 PalDefender Passives 陣列吃的內部 id。詞條沒有專屬圖示(遊戲內只有
 *    等級箭頭),所以只存 rank,前端自己畫箭頭。
 *  - 主動技:名稱取自 paldb.cc/en/Active_Skills(EPalWazaID::<id> -> 名稱),
 *    元素取自 paldeck.cc/skills(waza_type -> element),以內部 id 對接。
 *
 * 產出:
 *  packages/web/public/game-data/passives.json      [{id,name,rank}]
 *  packages/web/public/game-data/activeSkills.json  [{id,name,element}]
 *
 * 用法:node scripts/fetch-skills-passives.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "packages/web/public/game-data");
const UA = "palserver-gui-data-sync (maintainer-approved; github.com/io-software-ai/palserver-gui)";

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/** 把 Next.js 頁面裡的 self.__next_f.push([n,"..."]) 片段解碼拼回完整字串。 */
function nextFlight(html) {
  let blob = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/gs)) {
    try {
      blob += JSON.parse(m[1]);
    } catch {
      /* 略過壞片段 */
    }
  }
  return blob;
}

/** 詞條:從 paldeck 串流資料抓 Asset/Name/Rank。 */
function parsePassives(blob) {
  const out = [];
  const re = /\{"Asset":"([^"]+)","Name":"((?:[^"\\]|\\.)*)","Rank":(-?\d+)/g;
  for (const [, asset, rawName, rank] of blob.matchAll(re)) {
    const name = JSON.parse(`"${rawName}"`);
    out.push({ id: asset, name, rank: Number(rank) });
  }
  return out;
}

/** 主動技名稱:paldb 索引頁 EPalWazaID::<id> -> 名稱。 */
function parsePaldbWaza(html) {
  const names = new Map();
  const re =
    /data-hover="\?s=Waza%2FEPalWazaID%3A%3A([^"]+)"[^>]*>((?:[^<]|<(?!\/a>))*)<\/a>/g;
  for (const [, id, rawName] of html.matchAll(re)) {
    const name = rawName.replace(/<[^>]*>/g, "").trim();
    if (name && !names.has(id)) names.set(decodeURIComponent(id), name);
  }
  return names;
}

/** 主動技元素:paldeck 串流資料 waza_type -> element。 */
function parsePaldeckElements(blob) {
  const el = new Map();
  for (const [, id, element] of blob.matchAll(/"waza_type":"([^"]+)"[^}]*?"element":"([^"]+)"/g)) {
    el.set(id, element);
  }
  return el;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  // ── 詞條 ──
  const passivesHtml = await get("https://paldeck.cc/passives");
  const passivesRaw = parsePassives(nextFlight(passivesHtml));
  // 去重(同 id 取第一筆),按 rank 高到低排。
  const seen = new Set();
  const passives = [];
  for (const p of passivesRaw) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    passives.push({ id: p.id, name: p.name, rank: p.rank });
  }
  passives.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  await writeFile(path.join(DATA_DIR, "passives.json"), JSON.stringify(passives) + "\n");

  // ── 主動技 ──
  const [wazaHtml, skillsHtml] = await Promise.all([
    get("https://paldb.cc/en/Active_Skills"),
    get("https://paldeck.cc/skills"),
  ]);
  const names = parsePaldbWaza(wazaHtml);
  const elements = parsePaldeckElements(nextFlight(skillsHtml));
  const skills = [];
  const skillSeen = new Set();
  for (const [id, name] of names) {
    if (skillSeen.has(id)) continue;
    skillSeen.add(id);
    skills.push({ id, name, ...(elements.get(id) ? { element: elements.get(id) } : {}) });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(path.join(DATA_DIR, "activeSkills.json"), JSON.stringify(skills) + "\n");

  console.log(`passives.json: ${passives.length} 條`);
  console.log(`activeSkills.json: ${skills.length} 條(有元素 ${skills.filter((s) => s.element).length})`);
}

await main();
