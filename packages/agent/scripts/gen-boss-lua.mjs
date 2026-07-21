// 由 mods/palserver-boss-reporter/Scripts/main.lua 生成 boss-reporter-lua.generated.ts。
// 單一真實來源是那個 .lua 檔(有語法高亮、可獨立部署測試);安裝時 agent 從常數寫檔。
// 用法:node packages/agent/scripts/gen-boss-lua.mjs(或 pnpm --filter @palserver/agent gen:boss-lua)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const luaPath = path.join(repoRoot, "mods", "palserver-boss-reporter", "Scripts", "main.lua");
const outPath = path.join(here, "..", "src", "boss-reporter-lua.generated.ts");

const lua = fs.readFileSync(luaPath, "utf8");
const banner =
  "// 自動生成,請勿手動編輯。改 Lua 請改 mods/palserver-boss-reporter/Scripts/main.lua,\n" +
  "// 再跑 `pnpm --filter @palserver/agent gen:boss-lua`。\n";
const body = `${banner}export const BOSS_REPORTER_LUA = ${JSON.stringify(lua)};\n`;
fs.writeFileSync(outPath, body);
console.log(`wrote ${path.relative(repoRoot, outPath)} (${lua.length} bytes of Lua)`);
