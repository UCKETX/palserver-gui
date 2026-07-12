import fs from "node:fs";
import path from "node:path";
import { type EngineSettings, type EngineSettingsStatus } from "@palserver/shared";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { serverRoot } from "./native.js";
import { readFileInPod, writeFileInPod } from "./k8s.js";
import { mergeEnginePatch, parseEngineValues } from "./engine-ini-merge.js";

/**
 * Read/write the managed subset of Engine.ini.
 *
 * Engine.ini belongs to the user: it may hold sections and keys we know
 * nothing about (mods, hand-tuned cvars). Writes therefore merge in place —
 * we rewrite only the keys we manage, keep every other line byte-for-byte,
 * and append sections only when they're missing.
 *
 * On k8s the file lives in the game-server Pod under /palworld/, reached via
 * `kubectl exec`; the Pod filesystem is always Linux, so its path uses
 * LinuxServer regardless of the agent host's platform.
 */

const CONFIG_PLATFORM_DIR = process.platform === "win32" ? "WindowsServer" : "LinuxServer";
const REL_PATH = `Pal/Saved/Config/${CONFIG_PLATFORM_DIR}/Engine.ini`;
const K8S_REL_PATH = "Pal/Saved/Config/LinuxServer/Engine.ini";

const enginePath = (root: string) => path.join(root, ...REL_PATH.split("/"));

/** Backend-aware Engine.ini read: native/docker hit the host FS (docker via
 * bind-mount), k8s reaches the Pod over exec. Returns null when absent. */
async function readEngineIni(rec: InstanceRecord, ctx: DriverContext): Promise<string | null> {
  if (rec.backend === "k8s") {
    return readFileInPod(rec, K8S_REL_PATH).catch(() => null);
  }
  // docker: bind-mount saved = Pal/Saved, so config is under saved/Config/...
  const base = rec.backend === "docker"
    ? path.join(ctx.instanceDir, "saved")
    : serverRoot(rec, ctx);
  const rel = rec.backend === "docker"
    ? `Saved/Config/${CONFIG_PLATFORM_DIR}/Engine.ini`
    : REL_PATH;
  const file = path.join(base, ...rel.split("/"));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** Backend-aware Engine.ini write. native/docker ensures the config dir exists;
 * k8s writes into the running Pod. */
async function writeEngineIni(rec: InstanceRecord, ctx: DriverContext, content: string): Promise<void> {
  if (rec.backend === "k8s") {
    await writeFileInPod(rec, K8S_REL_PATH, content);
    return;
  }
  const base = rec.backend === "docker"
    ? path.join(ctx.instanceDir, "saved")
    : serverRoot(rec, ctx);
  const rel = rec.backend === "docker"
    ? `Saved/Config/${CONFIG_PLATFORM_DIR}/Engine.ini`
    : REL_PATH;
  const file = path.join(base, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export async function getEngineSettings(
  rec: InstanceRecord,
  ctx: DriverContext,
): Promise<EngineSettingsStatus> {
  const displayPath = rec.backend === "k8s" ? K8S_REL_PATH : REL_PATH;
  const raw = await readEngineIni(rec, ctx);
  // 顯示以 store 為準:伺服器每次關機都會把 Engine.ini 重寫回它自己的預設,
  // 若直接讀檔,使用者剛存的微調在 start→stop 一輪後就「看起來被重置」了。
  // store 有值就用 store,否則(舊實例、還沒經這版存過)退回解析檔案做遷移顯示。
  const values = rec.engineSettings ?? (raw === null ? {} : parseEngineValues(raw));
  if (raw === null && !rec.engineSettings) {
    return {
      supported: true,
      reason: "Engine.ini 尚未產生 — 先啟動一次伺服器,或直接儲存以建立檔案",
      exists: false,
      path: displayPath,
      values: {},
    };
  }
  return { supported: true, exists: raw !== null, path: displayPath, values };
}

/**
 * Merge `patch` into the managed engine settings and write them into Engine.ini
 * (preserving unmanaged content). Returns the status plus the full merged set
 * so the caller can persist it in the store — the store, not the file, is the
 * source of truth, because the running server rewrites Engine.ini on shutdown
 * and would otherwise wipe these values after one start/stop cycle. The values
 * are re-applied to Engine.ini before every start (see native.ts writeIni).
 */
export async function writeEngineSettings(
  rec: InstanceRecord,
  ctx: DriverContext,
  patch: EngineSettings,
): Promise<{ status: EngineSettingsStatus; engineSettings: EngineSettings }> {
  const existing = (await readEngineIni(rec, ctx)) ?? "";
  // 累積在 store:既有值(store 優先,舊實例從檔案遷移)疊上這次的 patch。
  const merged: EngineSettings = { ...(rec.engineSettings ?? parseEngineValues(existing)), ...patch };
  await writeEngineIni(rec, ctx, mergeEnginePatch(existing, merged));
  const next: InstanceRecord = { ...rec, engineSettings: merged };
  return { status: await getEngineSettings(next, ctx), engineSettings: merged };
}
