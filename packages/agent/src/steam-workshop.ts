import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import extractZip from "extract-zip";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { DATA_DIR } from "./env.js";
import { serverRoot } from "./native.js";
import { serverPlatform } from "./platform.js";

const execFileP = promisify(execFile);
const STEAMCMD_URL = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const WORKSHOP_APP_ID = "1623730";
const STATE_FILE = path.join(DATA_DIR, "steam-workshop.json");
const STEAMCMD_DIR = path.join(DATA_DIR, "tools", "steamcmd");
const STEAMCMD_EXE = path.join(STEAMCMD_DIR, "steamcmd.exe");
const DOWNLOAD_LIMIT = 32 * 1024 * 1024;
const MOD_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
const MOD_FILE_LIMIT = 20_000;
const SEARCH_TIMEOUT_MS = 20_000;
const SEARCH_RESPONSE_LIMIT = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

interface WorkshopState {
  apiKey?: string;
  accountName?: string;
  pendingAccount?: string;
  lastVerifiedAt?: string;
}

export interface WorkshopStatus {
  supported: boolean;
  reason?: string;
  apiKeyConfigured: boolean;
  steamcmdInstalled: boolean;
  loggedIn: boolean;
  accountName?: string;
  lastVerifiedAt?: string;
  appId: string;
}

export interface WorkshopItem {
  id: string;
  title: string;
  summary: string;
  previewUrl?: string;
  steamUrl: string;
  tags: string[];
  fileSize?: number;
  subscriptions?: number;
  timeCreated?: number;
  timeUpdated?: number;
  installed: boolean;
  updateAvailable: boolean;
}

export interface WorkshopSearchResult {
  items: WorkshopItem[];
  total: number;
  pageSize: number;
  nextCursor?: string;
}

interface ModInfo {
  Name?: string;
  Version?: string;
  PackageName: string;
}

function fail(message: string, statusCode = 422): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function readState(): WorkshopState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as WorkshopState;
  } catch {
    return {};
  }
}

function writeState(patch: Partial<WorkshopState>): WorkshopState {
  const next = { ...readState(), ...patch };
  for (const key of Object.keys(next) as (keyof WorkshopState)[]) {
    if (!next[key]) delete next[key];
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, STATE_FILE);
  return next;
}

export function workshopStatus(): WorkshopStatus {
  const state = readState();
  const supported = process.platform === "win32";
  return {
    supported,
    reason: supported ? undefined : "SteamCMD Workshop 登入與下載目前僅支援 Windows agent",
    apiKeyConfigured: Boolean(state.apiKey),
    steamcmdInstalled: fs.existsSync(STEAMCMD_EXE),
    loggedIn: Boolean(state.accountName && state.lastVerifiedAt),
    accountName: state.accountName,
    lastVerifiedAt: state.lastVerifiedAt,
    appId: WORKSHOP_APP_ID,
  };
}

export function setSteamWebApiKey(apiKey: string): WorkshopStatus {
  const clean = apiKey.trim();
  if (!/^[A-Fa-f0-9]{32}$/.test(clean)) throw fail("Steam Web API Key 應為 32 位十六進位字元", 400);
  writeState({ apiKey: clean });
  return workshopStatus();
}

function assertWindows(): void {
  if (process.platform !== "win32") throw fail("SteamCMD Workshop 登入與下載目前僅支援 Windows agent", 409);
}

function validateAccount(accountName: string): string {
  const clean = accountName.trim();
  if (!/^[A-Za-z0-9_]{3,64}$/.test(clean)) throw fail("Steam 帳號名稱格式不合法", 400);
  return clean;
}

async function hardenSteamCredentials(): Promise<void> {
  assertWindows();
  const configDir = path.join(STEAMCMD_DIR, "config");
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  try {
    const { stdout } = await execFileP("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
    const sid = stdout.match(/"[^"]*","(S-[0-9-]+)"/i)?.[1];
    if (!sid) throw new Error("cannot determine current Windows SID");
    await execFileP("icacls.exe", [
      configDir,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
      "*S-1-5-32-544:(OI)(CI)F",
      "/T",
      "/C",
    ], { windowsHide: true });
  } catch (error) {
    throw fail(`無法保護 SteamCMD 登入快取: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}

async function downloadSteamCmd(): Promise<void> {
  assertWindows();
  if (fs.existsSync(STEAMCMD_EXE)) return;
  const temporary = `${STEAMCMD_DIR}.part`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  try {
    const response = await fetch(STEAMCMD_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw fail(`SteamCMD 下載失敗: HTTP ${response.status}`, 502);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > DOWNLOAD_LIMIT) throw fail("SteamCMD 安裝包大小異常", 502);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.byteLength > DOWNLOAD_LIMIT || content.subarray(0, 2).toString("ascii") !== "PK") {
      throw fail("SteamCMD 安裝包格式異常", 502);
    }
    const archive = path.join(temporary, "steamcmd.zip");
    fs.writeFileSync(archive, content);
    await extractZip(archive, { dir: temporary });
    fs.rmSync(archive, { force: true });
    if (!fs.existsSync(path.join(temporary, "steamcmd.exe"))) throw fail("SteamCMD 安裝包缺少 steamcmd.exe", 502);
    fs.rmSync(STEAMCMD_DIR, { recursive: true, force: true });
    fs.renameSync(temporary, STEAMCMD_DIR);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function startWorkshopLogin(accountName: string): Promise<WorkshopStatus> {
  assertWindows();
  const account = validateAccount(accountName);
  await downloadSteamCmd();
  await hardenSteamCredentials();
  writeState({ pendingAccount: account, accountName: undefined, lastVerifiedAt: undefined });
  const child = spawn(
    "cmd.exe",
    ["/d", "/c", "start", "", STEAMCMD_EXE, "+login", account],
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.unref();
  return workshopStatus();
}

async function runSteamCmd(args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<string> {
  await downloadSteamCmd();
  await hardenSteamCredentials();
  try {
    const { stdout, stderr } = await execFileP(STEAMCMD_EXE, args, {
      cwd: STEAMCMD_DIR,
      windowsHide: true,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
    const output = `${detail.stdout ?? ""}\n${detail.stderr ?? ""}`.trim();
    if (detail.killed) throw fail("SteamCMD 操作逾時", 504);
    throw fail(output ? `SteamCMD 失敗: ${output.slice(-2000)}` : `SteamCMD 失敗: ${detail.message}`, 502);
  }
}

export async function verifyWorkshopLogin(accountName?: string): Promise<WorkshopStatus> {
  assertWindows();
  const state = readState();
  const account = validateAccount(accountName || state.pendingAccount || state.accountName || "");
  const output = await runSteamCmd([
    "+@ShutdownOnFailedCommand", "1",
    "+@NoPromptForPassword", "1",
    "+login", account,
    "+quit",
  ], 90_000);
  if (!steamLoginSucceeded(output) || /FAILED|Invalid Password|No cached credentials|password required/i.test(output)) {
    writeState({ accountName: undefined, lastVerifiedAt: undefined });
    throw fail("尚未验证到 Steam 登录缓存；请先在弹出的 SteamCMD 窗口完成密码与 Steam Guard 登录，然后输入 quit", 409);
  }
  writeState({ accountName: account, pendingAccount: undefined, lastVerifiedAt: new Date().toISOString() });
  return workshopStatus();
}

export function steamLoginSucceeded(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("waiting for user info...ok") ||
    (normalized.includes("logging in using cached credentials") && normalized.includes("steam public...ok"));
}

function sortQueryType(sort: string): string {
  if (sort === "trend") return "3";
  if (sort === "new") return "1";
  if (sort === "updated") return "21";
  return "12";
}

function installedWorkshopState(rec: InstanceRecord, ctx: DriverContext): Map<string, number> {
  const result = new Map<string, number>();
  if (rec.backend !== "native") return result;
  const root = path.join(serverRoot(rec, ctx), "Mods", "Workshop");
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(root, entry.name, ".palserver-workshop.json"), "utf8")) as { timeUpdated?: number };
      result.set(entry.name, Number(marker.timeUpdated ?? 0));
    } catch {
      result.set(entry.name, 0);
    }
  }
  return result;
}

export function mapWorkshopResponse(
  payload: unknown,
  installed: Map<string, number> = new Map(),
): WorkshopSearchResult {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const response = (root.response && typeof root.response === "object" ? root.response : {}) as Record<string, unknown>;
  const details = Array.isArray(response.publishedfiledetails) ? response.publishedfiledetails : [];
  const items = details.map((raw): WorkshopItem => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = String(item.publishedfileid ?? "");
    const updated = Number(item.time_updated ?? 0);
    const installedUpdated = installed.get(id);
    return {
      id,
      title: String(item.title ?? id),
      summary: String(item.short_description ?? item.file_description ?? "").replace(/\[\/?[^\]]+\]/g, "").slice(0, 500),
      previewUrl: typeof item.preview_url === "string" ? item.preview_url : undefined,
      steamUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
      tags: Array.isArray(item.tags)
        ? item.tags.map((tag) => String((tag as Record<string, unknown>)?.tag ?? "")).filter(Boolean)
        : [],
      fileSize: Number(item.file_size ?? 0) || undefined,
      subscriptions: Number(item.subscriptions ?? item.lifetime_subscriptions ?? 0) || undefined,
      timeCreated: Number(item.time_created ?? 0) || undefined,
      timeUpdated: updated || undefined,
      installed: installed.has(id),
      updateAvailable: installedUpdated !== undefined && installedUpdated > 0 && updated > installedUpdated,
    };
  }).filter((item) => /^\d+$/.test(item.id));
  return {
    items,
    total: Number(response.total ?? items.length),
    pageSize: items.length,
    nextCursor: typeof response.next_cursor === "string" && response.next_cursor ? response.next_cursor : undefined,
  };
}

export async function searchWorkshop(
  rec: InstanceRecord,
  ctx: DriverContext,
  params: { query?: string; sort?: string; cursor?: string; pageSize?: number },
): Promise<WorkshopSearchResult> {
  const state = readState();
  if (!state.apiKey) throw fail("请先设置 Steam Web API Key", 409);
  const pageSize = Math.max(1, Math.min(50, Math.floor(params.pageSize ?? 24)));
  const values = new URLSearchParams({
    key: state.apiKey,
    format: "json",
    query_type: sortQueryType(params.sort ?? "popular"),
    page: "1",
    cursor: params.cursor || "*",
    numperpage: String(pageSize),
    creator_appid: WORKSHOP_APP_ID,
    appid: WORKSHOP_APP_ID,
    filetype: "0",
    return_tags: "1",
    return_previews: "1",
    return_short_description: "1",
    cache_max_age_seconds: "60",
  });
  if (params.query?.trim()) values.set("search_text", params.query.trim());
  const response = await fetch(`https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?${values}`, {
    headers: { "user-agent": "palserver-gui" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw fail(`Steam Workshop 搜索失败: HTTP ${response.status}`, 502);
  return mapWorkshopResponse(await readJsonResponse(response), installedWorkshopState(rec, ctx));
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > SEARCH_RESPONSE_LIMIT) throw fail("Steam API 回应内容过大", 502);
  const body = await response.arrayBuffer();
  if (body.byteLength > SEARCH_RESPONSE_LIMIT) throw fail("Steam API 回应内容过大", 502);
  try {
    return JSON.parse(Buffer.from(body).toString("utf8")) as unknown;
  } catch {
    throw fail("Steam API 回应格式无效", 502);
  }
}

export function parsePalModSettings(content: string): { globalEnabled: boolean; activeMods: string[] } {
  const activeMods: string[] = [];
  let globalEnabled = true;
  for (const line of content.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.trim().split("=");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (key === "bglobalenablemod") globalEnabled = value.toLowerCase() !== "false";
    if (key === "activemodlist" && value) activeMods.push(value);
  }
  return { globalEnabled, activeMods };
}

export function enablePalMod(content: string, packageName: string): string {
  const settings = parsePalModSettings(content);
  const active = settings.activeMods.filter((name, index, all) =>
    name.toLowerCase() !== packageName.toLowerCase() && all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index,
  );
  active.push(packageName);
  return `[PalModSettings]\nbGlobalEnableMod=true\n${active.sort((a, b) => a.localeCompare(b)).map((name) => `ActiveModList=${name}`).join("\n")}\n`;
}

function inspectDownloadedMod(downloadRoot: string): { root: string; info: ModInfo } {
  const infoFiles: string[] = [];
  let fileCount = 0;
  let totalSize = 0;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw fail(`Workshop Mod 不允许符号链接: ${entry.name}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        fileCount++;
        totalSize += stat.size;
        if (entry.name.toLowerCase() === "info.json") infoFiles.push(absolute);
      } else throw fail(`Workshop Mod 包含不支持的文件类型: ${entry.name}`);
      if (fileCount > MOD_FILE_LIMIT || totalSize > MOD_SIZE_LIMIT) throw fail("Workshop Mod 内容超过安全上限", 413);
    }
  };
  visit(downloadRoot);
  if (infoFiles.length !== 1) throw fail(`Workshop Mod 必须且只能包含一个 Info.json，当前找到 ${infoFiles.length} 个`);
  let info: ModInfo;
  try {
    info = JSON.parse(fs.readFileSync(infoFiles[0], "utf8")) as ModInfo;
  } catch {
    throw fail("Workshop Mod 的 Info.json 格式无效");
  }
  info.PackageName = String(info.PackageName ?? "").trim();
  if (!info.PackageName || info.PackageName.length > 255 || /[\x00-\x1f\x7f]/.test(info.PackageName)) {
    throw fail("Workshop Mod 的 Info.json 缺少有效 PackageName");
  }
  return { root: path.dirname(infoFiles[0]), info };
}

function installDownloadedMod(
  rec: InstanceRecord,
  ctx: DriverContext,
  item: WorkshopItem,
  downloadedRoot: string,
): { packageName: string; name: string } {
  const inspected = inspectDownloadedMod(downloadedRoot);
  const modsRoot = path.join(serverRoot(rec, ctx), "Mods");
  const workshopRoot = path.join(modsRoot, "Workshop");
  const target = path.join(workshopRoot, item.id);
  const temporary = path.join(workshopRoot, `.${item.id}.installing`);
  const backup = path.join(workshopRoot, `.${item.id}.backup`);
  fs.mkdirSync(workshopRoot, { recursive: true });
  for (const entry of fs.readdirSync(workshopRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === item.id || !/^\d+$/.test(entry.name)) continue;
    try {
      const existing = inspectDownloadedMod(path.join(workshopRoot, entry.name));
      if (existing.info.PackageName.toLowerCase() === inspected.info.PackageName.toLowerCase()) {
        throw fail(`PackageName ${inspected.info.PackageName} 已由 Workshop 项目 ${entry.name} 使用`, 409);
      }
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) throw error;
      // Ignore malformed pre-existing directories; the current download was validated above.
    }
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.cpSync(inspected.root, temporary, { recursive: true, force: true, errorOnExist: false });
  fs.writeFileSync(path.join(temporary, ".palserver-workshop.json"), JSON.stringify({
    id: item.id,
    timeUpdated: item.timeUpdated ?? 0,
    installedAt: new Date().toISOString(),
  }, null, 2));
  const settingsFile = path.join(modsRoot, "PalModSettings.ini");
  const settingsExisted = fs.existsSync(settingsFile);
  const currentSettings = settingsExisted ? fs.readFileSync(settingsFile, "utf8") : "";
  try {
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(temporary, target);
    fs.writeFileSync(settingsFile, enablePalMod(currentSettings, inspected.info.PackageName));
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    try {
      if (settingsExisted) fs.writeFileSync(settingsFile, currentSettings);
      else fs.rmSync(settingsFile, { force: true });
    } catch {
      // Preserve the original installation error; recovery has already been attempted.
    }
    throw error;
  }
  return { packageName: inspected.info.PackageName, name: inspected.info.Name?.trim() || inspected.info.PackageName };
}

export async function installWorkshopItem(
  rec: InstanceRecord,
  ctx: DriverContext,
  itemId: string,
): Promise<{ id: string; title: string; packageName: string }> {
  assertWindows();
  if (rec.backend !== "native" || serverPlatform(rec) !== "windows") {
    throw fail("Steam Workshop 下载仅支持 Windows 原生实例", 409);
  }
  if (!/^\d{6,20}$/.test(itemId)) throw fail("Workshop Item ID 格式无效", 400);
  const state = readState();
  if (!state.accountName || !state.lastVerifiedAt) throw fail("请先完成并验证 SteamCMD 登录", 409);
  await verifyWorkshopLogin(state.accountName);
  const detail = await getWorkshopDetails(itemId);
  await runSteamCmd([
    "+@ShutdownOnFailedCommand", "1",
    "+@NoPromptForPassword", "1",
    "+login", state.accountName,
    "+workshop_download_item", WORKSHOP_APP_ID, itemId, "validate",
    "+quit",
  ]);
  const downloadedRoot = path.join(STEAMCMD_DIR, "steamapps", "workshop", "content", WORKSHOP_APP_ID, itemId);
  if (!fs.existsSync(downloadedRoot)) throw fail("SteamCMD 完成但找不到 Workshop 下载目录", 502);
  const installed = installDownloadedMod(rec, ctx, detail, downloadedRoot);
  return { id: itemId, title: installed.name || detail.title, packageName: installed.packageName };
}

async function getWorkshopDetails(itemId: string): Promise<WorkshopItem> {
  const values = new URLSearchParams({ itemcount: "1", "publishedfileids[0]": itemId });
  const response = await fetch("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "palserver-gui" },
    body: values,
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw fail(`Steam Workshop 详情查询失败: HTTP ${response.status}`, 502);
  const payload = await readJsonResponse(response) as { response?: { publishedfiledetails?: unknown[] } };
  const rawDetails = payload.response?.publishedfiledetails ?? [];
  const mapped = mapWorkshopResponse({ response: { publishedfiledetails: rawDetails } }).items[0];
  if (!mapped || mapped.id !== itemId) throw fail("找不到该 Steam Workshop 项目", 404);
  return mapped;
}
