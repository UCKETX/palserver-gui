import fs from "node:fs";
import path from "node:path";
import {
  ENGINE_OPTIONS,
  type EngineOptionKey,
  type EngineSettings,
  type EngineSettingsStatus,
} from "@palserver/shared";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { serverRoot } from "./native.js";

/**
 * Read/write the managed subset of Engine.ini.
 *
 * Engine.ini belongs to the user: it may hold sections and keys we know
 * nothing about (mods, hand-tuned cvars). Writes therefore merge in place —
 * we rewrite only the keys we manage, keep every other line byte-for-byte,
 * and append sections only when they're missing.
 */

const CONFIG_PLATFORM_DIR = process.platform === "win32" ? "WindowsServer" : "LinuxServer";
const REL_PATH = `Pal/Saved/Config/${CONFIG_PLATFORM_DIR}/Engine.ini`;

const enginePath = (root: string) => path.join(root, ...REL_PATH.split("/"));

/** Which section each managed key belongs to. */
const sectionOf = (key: EngineOptionKey) => ENGINE_OPTIONS[key].section;

function parseValue(key: EngineOptionKey, raw: string): number | boolean | null {
  const meta = ENGINE_OPTIONS[key];
  const value = raw.trim();
  if (meta.type === "bool") {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return meta.type === "int" ? Math.trunc(num) : num;
}

function formatValue(key: EngineOptionKey, value: number | boolean): string {
  const meta = ENGINE_OPTIONS[key];
  if (meta.type === "bool") return value ? "True" : "False";
  if (meta.type === "int") return String(Math.trunc(Number(value)));
  return Number(value).toFixed(6);
}

export function getEngineSettings(rec: InstanceRecord, ctx: DriverContext): EngineSettingsStatus {
  if (rec.backend !== "native") {
    return {
      supported: false,
      reason: "效能設定目前僅支援原生模式的實例",
      exists: false,
      path: null,
      values: {},
    };
  }
  const file = enginePath(serverRoot(rec, ctx));
  if (!fs.existsSync(file)) {
    return {
      supported: true,
      reason: "Engine.ini 尚未產生 — 先啟動一次伺服器,或直接儲存以建立檔案",
      exists: false,
      path: REL_PATH,
      values: {},
    };
  }

  const values: EngineSettings = {};
  let section = "";
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header) {
      section = header[1];
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.startsWith(";")) continue;
    const key = trimmed.slice(0, eq).trim() as EngineOptionKey;
    if (!(key in ENGINE_OPTIONS) || sectionOf(key) !== section) continue;
    const parsed = parseValue(key, trimmed.slice(eq + 1));
    if (parsed !== null) values[key] = parsed;
  }
  return { supported: true, exists: true, path: REL_PATH, values };
}

/**
 * Merge `patch` into Engine.ini, preserving unmanaged content. Keys already
 * present are rewritten in place; new keys are appended to their section;
 * missing sections are appended at the end.
 */
export function writeEngineSettings(
  rec: InstanceRecord,
  ctx: DriverContext,
  patch: EngineSettings,
): EngineSettingsStatus {
  if (rec.backend !== "native") {
    throw Object.assign(new Error("效能設定目前僅支援原生模式的實例"), { statusCode: 409 });
  }
  const file = enginePath(serverRoot(rec, ctx));
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const pending = new Map<EngineOptionKey, number | boolean>(
    Object.entries(patch) as [EngineOptionKey, number | boolean][],
  );

  // Pass 1: rewrite keys where they already live.
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header) {
      section = header[1];
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.startsWith(";")) continue;
    const key = trimmed.slice(0, eq).trim() as EngineOptionKey;
    if (!pending.has(key) || sectionOf(key) !== section) continue;
    lines[i] = `${key}=${formatValue(key, pending.get(key)!)}`;
    pending.delete(key);
  }

  // Pass 2: append the rest under their sections, creating sections as needed.
  for (const [key, value] of pending) {
    const target = sectionOf(key);
    const headerIndex = lines.findIndex((l) => l.trim() === `[${target}]`);
    const entry = `${key}=${formatValue(key, value)}`;
    if (headerIndex === -1) {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(`[${target}]`, entry);
      continue;
    }
    // Insert after the last non-empty line of that section.
    let end = headerIndex + 1;
    let lastContent = headerIndex;
    while (end < lines.length && !/^\[.+\]$/.test(lines[end].trim())) {
      if (lines[end].trim() !== "") lastContent = end;
      end++;
    }
    lines.splice(lastContent + 1, 0, entry);
  }

  fs.writeFileSync(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
  return getEngineSettings(rec, ctx);
}
