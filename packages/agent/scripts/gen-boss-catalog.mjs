// 由 packages/web/public/game-data/{bosses,worldtree-bosses}.json 生成
// packages/agent/src/boss-catalog.generated.ts。單一真實來源是 web 的 game-data JSON;
// agent 不讀 web bundle,建置期把兩份 catalog 的 {x,y} 硬編成常數。
// 用法:node packages/agent/scripts/gen-boss-catalog.mjs
//      (或 pnpm --filter @palserver/agent gen:boss-catalog)
//
// 只取野外/封印頭目(bosses.json、worldtree-bosses.json)。**不讀**
// dungeon-bosses.json —— 地城頭目不上公開地圖(頭目重生分頁已涵蓋),依使用者決定
// 這次改動範圍刻意排除地城。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const gameDataDir = path.join(repoRoot, "packages", "web", "public", "game-data");
const outPath = path.join(here, "..", "src", "boss-catalog.generated.ts");

/** @param {string} file @returns {{x:number,y:number}[]} */
function readCatalog(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(gameDataDir, file), "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array`);
  return raw.map((entry) => ({ x: entry.x, y: entry.y }));
}

const field = readCatalog("bosses.json");
const tree = readCatalog("worldtree-bosses.json");

const banner =
  "// 自動生成,請勿手動編輯。改內容請改 packages/web/public/game-data/{bosses,worldtree-bosses}.json,\n" +
  "// 再跑 `pnpm --filter @palserver/agent gen:boss-catalog`。\n" +
  "// 只含野外/封印頭目座標(地城頭目不上公開地圖,見 public-map.ts)。\n";

const body =
  `${banner}import type { PublicBossCatalogEntry } from "@palserver/shared";\n\n` +
  `export const FIELD_BOSS_CATALOG: PublicBossCatalogEntry[] = ${JSON.stringify(field)};\n\n` +
  `export const TREE_BOSS_CATALOG: PublicBossCatalogEntry[] = ${JSON.stringify(tree)};\n`;

fs.writeFileSync(outPath, body);
console.log(
  `wrote ${path.relative(repoRoot, outPath)} (field=${field.length}, tree=${tree.length})`,
);
