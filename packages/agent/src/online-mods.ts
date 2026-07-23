import { spawn } from "node:child_process";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import extractZip from "extract-zip";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { serverRoot } from "./native.js";
import { serverPlatform } from "./platform.js";
import { execInPod, makeDirInPod, writeFileBytesInPod } from "./k8s-files.js";
import { execInContainer, putArchiveToContainer } from "./docker.js";

const DOWNLOAD_LIMIT = 512 * 1024 * 1024;
const EXTRACTED_LIMIT = 1024 * 1024 * 1024;
const ENTRY_LIMIT = 10_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
const CONTAINER_ROOT = "/palworld";

export interface OnlineModInstallResult {
  source: string;
  name: string;
  pakFiles: string[];
  luaMods: string[];
}

interface InstallFile {
  source: string;
  destination: string;
}

export interface OnlineModPlan {
  files: InstallFile[];
  pakFiles: string[];
  luaMods: string[];
}

function fail(message: string, statusCode = 422): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return !isPrivateIpv4(address);
  if (!net.isIPv6(address)) return false;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return !isPrivateIpv4(mapped);
  return !(
    normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("2001:db8:")
  );
}

export function parseOnlineModSource(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw fail("請輸入有效的 GitHub 或 HTTPS 下載網址", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw fail("只接受不含帳號密碼的公開 HTTPS 網址", 400);
  }
  return url;
}

async function assertPublicUrl(url: URL): Promise<void> {
  const records = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw fail(`無法解析下載主機: ${url.hostname}`, 502);
  });
  if (records.length === 0 || records.some((record) => !isPublicAddress(record.address))) {
    throw fail("下載網址不可指向本機、區域網路或保留位址", 400);
  }
}

async function fetchPublic(url: URL, init: RequestInit = {}, redirects = 0): Promise<Response> {
  await assertPublicUrl(url);
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      "user-agent": "palserver-gui",
      accept: "application/octet-stream, application/vnd.github+json",
      ...init.headers,
    },
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw fail("下載重新導向次數過多", 502);
    const location = response.headers.get("location");
    if (!location) throw fail("下載服務回傳無效的重新導向", 502);
    return fetchPublic(new URL(location, url), init, redirects + 1);
  }
  return response;
}

function githubParts(url: URL): { owner: string; repo: string; tag?: string } | null {
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) return null;
  const tag = parts[2] === "releases" && parts[3] === "tag" ? parts.slice(4).join("/") : undefined;
  if (parts.length === 2 || parts[2] === "releases" && (parts.length === 3 || parts[3] === "latest" || tag)) {
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, ""), tag };
  }
  return null;
}

async function resolveSource(raw: string): Promise<URL> {
  const source = parseOnlineModSource(raw);
  const github = githubParts(source);
  if (!github) return source;
  const endpoint = github.tag
    ? `https://api.github.com/repos/${github.owner}/${github.repo}/releases/tags/${encodeURIComponent(github.tag)}`
    : `https://api.github.com/repos/${github.owner}/${github.repo}/releases/latest`;
  const response = await fetchPublic(new URL(endpoint), { headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) throw fail(`GitHub Release 查詢失敗: HTTP ${response.status}`, 502);
  const release = await response.json() as {
    assets?: { name?: string; browser_download_url?: string }[];
  };
  const candidates = (release.assets ?? []).filter((asset) =>
    typeof asset.browser_download_url === "string" && /\.(zip|pak)$/i.test(asset.name ?? ""),
  );
  if (candidates.length === 0) throw fail("此 GitHub Release 沒有 ZIP 或 PAK 資產", 422);
  const preferred = candidates.find((asset) => /server|palworld|mod/i.test(asset.name ?? "")) ?? candidates[0];
  return parseOnlineModSource(preferred.browser_download_url!);
}

function responseFileName(response: Response, url: URL): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const value = encoded ? decodeURIComponent(encoded) : plain ?? path.posix.basename(url.pathname);
  return path.basename(value || "download.zip");
}

async function downloadToFile(source: string, target: string): Promise<{ url: URL; name: string }> {
  const url = await resolveSource(source);
  const response = await fetchPublic(url);
  if (!response.ok || !response.body) throw fail(`Mod 下載失敗: HTTP ${response.status}`, 502);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > DOWNLOAD_LIMIT) throw fail("下載檔案超過 512 MB 上限", 413);

  const output = fs.createWriteStream(target, { flags: "wx" });
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > DOWNLOAD_LIMIT) throw fail("下載檔案超過 512 MB 上限", 413);
      if (!output.write(Buffer.from(chunk))) await once(output, "drain");
    }
    output.end();
    await once(output, "close");
  } catch (error) {
    output.destroy();
    fs.rmSync(target, { force: true });
    throw error;
  }
  return { url, name: responseFileName(response, url) };
}

function safeArchivePath(raw: string): void {
  const normalized = raw.replaceAll("\\", "/").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw fail(`ZIP 含有不安全路徑: ${raw}`);
  }
  const clean = path.posix.normalize(normalized);
  if (clean !== normalized || clean.split("/").includes("..")) throw fail(`ZIP 含有不安全路徑: ${raw}`);
  for (const component of clean.split("/")) {
    if (component.endsWith(".") || component.endsWith(" ") || /[<>"|?*:\x00-\x1f\x7f]/.test(component)) {
      throw fail(`ZIP 含有 Windows 不支援的路徑: ${raw}`);
    }
    const base = component.split(".")[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])$/.test(base)) {
      throw fail(`ZIP 含有 Windows 保留檔名: ${raw}`);
    }
  }
}

async function extractChecked(zipPath: string, destination: string): Promise<void> {
  let entries = 0;
  let extractedBytes = 0;
  const seen = new Set<string>();
  await extractZip(zipPath, {
    dir: destination,
    onEntry: (entry) => {
      safeArchivePath(entry.fileName);
      entries++;
      extractedBytes += entry.uncompressedSize;
      if (entries > ENTRY_LIMIT) throw fail(`ZIP 檔案數超過 ${ENTRY_LIMIT} 個上限`);
      if (extractedBytes > EXTRACTED_LIMIT) throw fail("ZIP 解壓後超過 1 GB 上限", 413);
      const key = entry.fileName.replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) throw fail(`ZIP 含有重複路徑: ${entry.fileName}`);
      seen.add(key);
      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      if ((mode & 0xf000) === 0xa000) throw fail(`ZIP 不允許符號連結: ${entry.fileName}`);
    },
  });
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw fail(`Mod 內容不允許符號連結: ${entry.name}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw fail(`Mod 內容含有不支援的檔案類型: ${entry.name}`);
    }
  };
  visit(root);
  return files;
}

function safeModName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  if (!name) throw fail("無法判斷 Mod 名稱");
  return name.slice(0, 120);
}

export function buildOnlineModPlan(root: string): OnlineModPlan {
  const all = walkFiles(root);
  const files: InstallFile[] = [];
  const pakFiles: string[] = [];
  const luaMods: string[] = [];
  const destinations = new Set<string>();
  const add = (source: string, destination: string) => {
    const key = destination.toLowerCase();
    if (destinations.has(key)) throw fail(`Mod 內有重複的安裝檔名: ${destination}`);
    destinations.add(key);
    files.push({ source, destination });
  };

  for (const source of all.filter((file) => /\.(pak|utoc|ucas)$/i.test(file))) {
    const relative = path.relative(root, source).split(path.sep);
    const logic = relative.some((part) => part.toLowerCase() === "logicmods");
    const destination = `Pal/Content/Paks/${logic ? "LogicMods/" : ""}${path.basename(source)}`;
    add(source, destination);
    if (/\.pak$/i.test(source)) pakFiles.push(logic ? `LogicMods/${path.basename(source)}` : path.basename(source));
  }

  const mainScripts = all.filter((file) => {
    const parts = path.relative(root, file).split(path.sep).map((part) => part.toLowerCase());
    return parts.length >= 3 && parts.at(-2) === "scripts" && parts.at(-1) === "main.lua";
  });
  const luaRoots = new Map<string, string>();
  for (const mainScript of mainScripts) {
    const modRoot = path.dirname(path.dirname(mainScript));
    luaRoots.set(path.resolve(modRoot).toLowerCase(), modRoot);
  }
  for (const modRoot of luaRoots.values()) {
    const name = safeModName(path.basename(modRoot));
    luaMods.push(name);
    for (const source of all.filter((file) => file === modRoot || file.startsWith(modRoot + path.sep))) {
      const relative = path.relative(modRoot, source).split(path.sep).join("/");
      add(source, `Pal/Binaries/Win64/ue4ss/Mods/${name}/${relative}`);
    }
  }

  if (pakFiles.length === 0 && luaMods.length === 0) {
    throw fail("下載內容未找到 .pak Mod 或含 Scripts/main.lua 的 UE4SS Lua Mod");
  }
  return { files, pakFiles, luaMods };
}

function stageInstall(plan: OnlineModPlan, staging: string): void {
  for (const file of plan.files) {
    const destination = path.join(staging, ...file.destination.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.source, destination);
  }
  for (const name of plan.luaMods) {
    const enabled = path.join(staging, "Pal", "Binaries", "Win64", "ue4ss", "Mods", name, "enabled.txt");
    if (!fs.existsSync(enabled)) fs.writeFileSync(enabled, "");
  }
}

async function installStaging(rec: InstanceRecord, ctx: DriverContext, staging: string): Promise<void> {
  if (rec.backend === "native") {
    fs.cpSync(staging, serverRoot(rec, ctx), { recursive: true, force: true });
    return;
  }
  if (rec.backend === "docker") {
    await execInContainer(rec, ["mkdir", "-p", CONTAINER_ROOT]);
    const tar = spawn("tar", ["-cf", "-", "-C", staging, "."], { windowsHide: true });
    const stderr: Buffer[] = [];
    tar.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    await Promise.all([
      putArchiveToContainer(rec, tar.stdout, CONTAINER_ROOT),
      new Promise<void>((resolve, reject) => {
        tar.on("error", reject);
        tar.on("close", (code) => code === 0 ? resolve() : reject(new Error(Buffer.concat(stderr).toString("utf8") || `tar exited ${code}`)));
      }),
    ]);
    return;
  }
  for (const file of walkFiles(staging)) {
    const relative = path.relative(staging, file).split(path.sep).join("/");
    const parent = path.posix.dirname(relative);
    if (parent !== ".") await makeDirInPod(rec, parent);
    await writeFileBytesInPod(rec, relative, fs.readFileSync(file));
  }
}

export async function installOnlineMod(
  rec: InstanceRecord,
  ctx: DriverContext,
  source: string,
): Promise<OnlineModInstallResult> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-online-mod-"));
  try {
    const download = path.join(temporary, "download");
    const { url, name } = await downloadToFile(source, download);
    const extracted = path.join(temporary, "extracted");
    fs.mkdirSync(extracted);
    const header = Buffer.alloc(4);
    const handle = fs.openSync(download, "r");
    fs.readSync(handle, header, 0, header.length, 0);
    fs.closeSync(handle);
    if (header.subarray(0, 2).toString("ascii") === "PK") {
      await extractChecked(download, extracted);
    } else if (/\.pak$/i.test(name) || /\.pak$/i.test(url.pathname)) {
      fs.copyFileSync(download, path.join(extracted, safeModName(name.replace(/\.pak$/i, "")) + ".pak"));
    } else {
      throw fail("下載內容不是有效 ZIP，且網址或檔名不是 .pak");
    }
    const plan = buildOnlineModPlan(extracted);
    if (plan.luaMods.length > 0 && serverPlatform(rec) !== "windows") {
      throw fail("此下載包含 UE4SS Lua Mod，但目前實例不是 Windows 伺服器；只有 Pak Mod 支援此平台", 409);
    }
    const staging = path.join(temporary, "install");
    fs.mkdirSync(staging);
    stageInstall(plan, staging);
    await installStaging(rec, ctx, staging);
    return { source: url.toString(), name, pakFiles: plan.pakFiles, luaMods: plan.luaMods };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
