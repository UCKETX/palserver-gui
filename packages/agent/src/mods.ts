import fs from "node:fs";
import path from "node:path";
import extractZip from "extract-zip";
import type { ModComponent, ModsStatus } from "@palserver/shared";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { serverRoot } from "./native.js";

/**
 * Mod management for native instances (the v1 headline feature, rebuilt):
 *  - PalDefender (formerly PalGuard): standalone anti-cheat, extracted into
 *    Pal/Binaries/Win64 (PalDefender.dll + d3d9.dll proxy loader); its config
 *    tree self-generates under Win64/PalDefender on first boot.
 *    Docs: https://ultimeit.github.io/PalDefender/
 *  - UE4SS: Lua/Blueprint mod loader, extracted into the same dir
 *    (dwmapi.dll + ue4ss/). Lua mods live in ue4ss/Mods, toggled via mods.txt.
 * Both are fetched from their GitHub latest release (URL overridable via env).
 */

const GH_REPOS: Record<ModComponent, { repo: string; asset: RegExp; envUrl: string }> = {
  ue4ss: {
    repo: "UE4SS-RE/RE-UE4SS",
    /* UE4SS experimental-latest 資產名含 git 資訊(例:UE4SS_v3.0.1-1011-gb50986bd.zip)。 */
    asset: /^UE4SS_v?[\d.]+(-[\d]+-g[0-9a-f]+)?\.zip$/i,
    envUrl: "PALSERVER_UE4SS_URL",
  },
  paldefender: {
    // The wiki names the asset PalDefender_Windows.zip but releases currently
    // ship it as PalDefender.zip — accept both.
    repo: "Ultimeit/PalDefender",
    asset: /^PalDefender(_Windows)?\.zip$/i,
    envUrl: "PALSERVER_PALDEFENDER_URL",
  },
};

const win64Dir = (root: string) => path.join(root, "Pal", "Binaries", "Win64");

/** Cheap fs check of which enhancements are installed, for instance summaries. */
export function installedEnhancements(root: string): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(win64Dir(root), "PalDefender.dll"))) out.push("PalDefender");
  if (
    fs.existsSync(path.join(win64Dir(root), "ue4ss", "UE4SS.dll")) ||
    fs.existsSync(path.join(win64Dir(root), "UE4SS.dll"))
  ) {
    out.push("UE4SS");
  }
  return out;
}
/** UE4SS mods dir — new layout (ue4ss/Mods) or the flat pre-3.1 layout (Mods). */
const ue4ssModsDir = (root: string) => {
  const nested = path.join(win64Dir(root), "ue4ss", "Mods");
  return fs.existsSync(nested) ? nested : path.join(win64Dir(root), "Mods");
};
const paksDir = (root: string) => path.join(root, "Pal", "Content", "Paks");
/** Marker recording which versions the GUI installed, plus the top-level
 * files each component's archive extracted — so uninstall removes exactly
 * those. Older markers only carry the version strings. */
interface ModsMarker {
  paldefender?: string;
  ue4ss?: string;
  files?: Partial<Record<ModComponent, string[]>>;
}
const markerFile = (root: string) => path.join(win64Dir(root), ".palserver-mods.json");

function readMarker(root: string): ModsMarker {
  try {
    return JSON.parse(fs.readFileSync(markerFile(root), "utf8")) as ModsMarker;
  } catch {
    return {};
  }
}

function writeMarker(root: string, component: ModComponent, version: string, files?: string[]): void {
  const marker = readMarker(root);
  marker[component] = version;
  if (files) marker.files = { ...(marker.files ?? {}), [component]: files };
  fs.writeFileSync(markerFile(root), JSON.stringify(marker, null, 2));
}

async function extractZipTracked(zipPath: string, dir: string): Promise<string[]> {
  const top = new Set<string>();
  await extractZip(zipPath, {
    dir,
    onEntry: (entry) => {
      const seg = entry.fileName.replace(/^\.\//, "").split(/[\\/]/)[0];
      if (seg) top.add(seg);
    },
  });
  return [...top];
}

/** Fallback removal set for mods installed before we tracked files. Excludes
 * any shared proxy DLL to avoid breaking the other component. */
const DEFAULT_MOD_FILES: Record<ModComponent, string[]> = {
  paldefender: ["PalDefender.dll", "PalDefender"],
  ue4ss: ["UE4SS.dll", "UE4SS-settings.ini", "ue4ss", "Mods"],
};

export function getModsStatus(rec: InstanceRecord, ctx: DriverContext): ModsStatus {
  const unsupported = (reason: string): ModsStatus => ({
    supported: false,
    reason,
    ue4ss: { installed: false, version: null },
    paldefender: { installed: false, version: null },
    luaMods: [],
    luaModsDir: null,
    pakMods: [],
  });

  if (rec.backend !== "native") {
    return unsupported("模組管理需要 Windows 原生模式(UE4SS/PalDefender 是 Windows DLL,在 Linux 容器/Pod 內無法載入)");
  }
  // Linux/macOS 原生模式:伺服器跑得起來,但 UE4SS/PalDefender 官方僅支援 Windows
  // 專用伺服器 —— 不擋在「未安裝」的誤導文案,明講平台限制。
  if (process.platform !== "win32") {
    return unsupported("UE4SS/PalDefender 僅支援 Windows 伺服器,這台主機無法使用 DLL 模組(純內容 .pak 模組不受影響)");
  }
  const root = serverRoot(rec, ctx);
  if (!fs.existsSync(win64Dir(root))) {
    return unsupported("伺服器尚未安裝完成 — 先啟動一次讓 agent 下載伺服器");
  }

  const marker = readMarker(root);
  const ue4ssInstalled =
    fs.existsSync(path.join(win64Dir(root), "ue4ss", "UE4SS.dll")) ||
    fs.existsSync(path.join(win64Dir(root), "UE4SS.dll"));
  const paldefenderInstalled = fs.existsSync(path.join(win64Dir(root), "PalDefender.dll"));

  const modsDir = ue4ssModsDir(root);
  return {
    supported: true,
    ue4ss: { installed: ue4ssInstalled, version: marker.ue4ss ?? null },
    paldefender: { installed: paldefenderInstalled, version: marker.paldefender ?? null },
    luaMods: listLuaMods(root),
    luaModsDir: fs.existsSync(modsDir)
      ? path.relative(root, modsDir).split(path.sep).join("/")
      : null,
    pakMods: listPakMods(root),
  };
}

function listLuaMods(root: string): { name: string; enabled: boolean }[] {
  const dir = ue4ssModsDir(root);
  if (!fs.existsSync(dir)) return [];
  const enabledFromTxt = parseModsTxt(root);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "shared")
    .map((e) => ({
      name: e.name,
      enabled:
        enabledFromTxt.get(e.name) === true ||
        fs.existsSync(path.join(dir, e.name, "enabled.txt")),
    }));
}

function parseModsTxt(root: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const file = path.join(ue4ssModsDir(root), "mods.txt");
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.trim().match(/^([\w-]+)\s*:\s*([01])$/);
    if (match) result.set(match[1], match[2] === "1");
  }
  return result;
}

function listPakMods(root: string): string[] {
  const results: string[] = [];
  const scan = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".pak") && !entry.name.startsWith("Pal-")) {
        results.push(prefix + entry.name);
      }
      if (entry.isDirectory() && entry.name === "LogicMods") {
        scan(path.join(dir, entry.name), "LogicMods/");
      }
    }
  };
  scan(paksDir(root), "");
  return results;
}

export function setLuaModEnabled(
  rec: InstanceRecord,
  ctx: DriverContext,
  name: string,
  enabled: boolean,
): void {
  const root = serverRoot(rec, ctx);
  const modDir = path.join(ue4ssModsDir(root), name);
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(modDir)) {
    throw Object.assign(new Error(`unknown lua mod: ${name}`), { statusCode: 404 });
  }
  // enabled.txt overrides mods.txt, so clear it when disabling.
  if (!enabled) fs.rmSync(path.join(modDir, "enabled.txt"), { force: true });

  const file = path.join(ue4ssModsDir(root), "mods.txt");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const flag = `${name} : ${enabled ? 1 : 0}`;
  const idx = lines.findIndex((l) => l.trim().startsWith(`${name} `) || l.trim().startsWith(`${name}:`));
  if (idx >= 0) lines[idx] = flag;
  else lines.unshift(flag);
  fs.writeFileSync(file, lines.join("\n"));
}

interface GitRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: { name: string; browser_download_url: string }[];
}

async function resolveDownload(
  component: ModComponent,
  channel: "stable" | "beta",
): Promise<{ version: string; url: string }> {
  const { repo, asset, envUrl } = GH_REPOS[component];
  const override = process.env[envUrl];
  if (override) return { version: "custom", url: override };

  // "latest" excludes pre-releases; for beta we scan the release list and take
  // the newest, whether it's a pre-release or stable.
  const endpoint =
    channel === "beta"
      ? `https://api.github.com/repos/${repo}/releases?per_page=15`
      : `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(endpoint, {
    headers: { "user-agent": "palserver-gui", accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub release lookup failed for ${repo}: HTTP ${res.status}`);

  const body = await res.json();
  const release: GitRelease | undefined = channel === "beta"
    ? (body as GitRelease[]).filter((r) => !r.draft).at(0)
    : (body as GitRelease);
  if (!release) throw new Error(`no releases found for ${repo}`);

  const match = release.assets.find((a) => asset.test(a.name));
  if (!match) {
    throw new Error(
      `no matching asset in ${repo}@${release.tag_name} (looked for ${asset}); ` +
        `set ${envUrl} to pin a download URL`,
    );
  }
  return { version: release.tag_name, url: match.browser_download_url };
}

export async function installComponent(
  rec: InstanceRecord,
  ctx: DriverContext,
  component: ModComponent,
  channel: "stable" | "beta" = "stable",
): Promise<{ version: string }> {
  const status = getModsStatus(rec, ctx);
  if (!status.supported) {
    throw Object.assign(new Error(status.reason ?? "mods unsupported"), { statusCode: 409 });
  }
  const root = serverRoot(rec, ctx);
  const { version, url } = await resolveDownload(component, channel);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  // instanceDir may not exist yet for adopted installs that were never started
  fs.mkdirSync(ctx.instanceDir, { recursive: true });
  const zipPath = path.join(ctx.instanceDir, `${component}.zip`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

  // Both zips are laid out relative to Pal/Binaries/Win64.
  const files = await extractZipTracked(zipPath, win64Dir(root));
  fs.rmSync(zipPath, { force: true });
  writeMarker(root, component, version, files);
  return { version };
}

/** Uninstall a component: remove the files its install extracted (tracked in
 * the marker; falls back to known defaults for older installs). Never removes
 * a file the other still-installed component also claims, so removing one mod
 * can't break the other. Caller must ensure the server is stopped (DLLs are
 * locked while running). */
export async function removeComponent(
  rec: InstanceRecord,
  ctx: DriverContext,
  component: ModComponent,
): Promise<void> {
  const status = getModsStatus(rec, ctx);
  if (!status.supported) {
    throw Object.assign(new Error(status.reason ?? "mods unsupported"), { statusCode: 409 });
  }
  const root = serverRoot(rec, ctx);
  const w64 = win64Dir(root);
  const marker = readMarker(root);

  const other: ModComponent = component === "ue4ss" ? "paldefender" : "ue4ss";
  const keep = new Set(
    status[other].installed ? (marker.files?.[other] ?? DEFAULT_MOD_FILES[other]) : [],
  );
  const targets = (
    marker.files?.[component]?.length ? marker.files[component]! : DEFAULT_MOD_FILES[component]
  ).filter((f) => !keep.has(f));

  for (const rel of targets) {
    const p = path.resolve(w64, rel);
    if (p === w64 || !p.startsWith(w64 + path.sep)) continue; // 安全:必須落在 Win64 之內
    fs.rmSync(p, { recursive: true, force: true });
  }

  delete marker[component];
  if (marker.files) delete marker.files[component];
  fs.writeFileSync(markerFile(root), JSON.stringify(marker, null, 2));
}
