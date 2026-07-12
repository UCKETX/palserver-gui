import { ENGINE_OPTIONS, type EngineOptionKey, type EngineSettings } from "@palserver/shared";

/**
 * Pure Engine.ini text helpers — no filesystem, no backend, no imports from
 * native.ts. Kept in its own module so both engine-ini.ts (read/write) and
 * native.ts (re-apply managed settings before each spawn) can use them without
 * an import cycle.
 *
 * Writes merge in place: only the keys we manage are rewritten, every other
 * line is kept byte-for-byte, and sections are appended only when missing.
 */

/** Which section each managed key belongs to. */
export const sectionOf = (key: EngineOptionKey): string => ENGINE_OPTIONS[key].section;

/** Parse the managed subset of keys out of raw Engine.ini text. */
export function parseEngineValues(raw: string): EngineSettings {
  const values: EngineSettings = {};
  let section = "";
  for (const line of raw.split(/\r?\n/)) {
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
  return values;
}

/** Merge `patch` into raw Engine.ini text, preserving unmanaged content.
 * Keys already present are rewritten in place; new keys are appended under
 * their section; missing sections are appended at the end. */
export function mergeEnginePatch(raw: string, patch: EngineSettings): string {
  const lines = raw.split(/\r?\n/);
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
    let end = headerIndex + 1;
    let lastContent = headerIndex;
    while (end < lines.length && !/^\[.+\]$/.test(lines[end].trim())) {
      if (lines[end].trim() !== "") lastContent = end;
      end++;
    }
    lines.splice(lastContent + 1, 0, entry);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

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

export function formatValue(key: EngineOptionKey, value: number | boolean): string {
  const meta = ENGINE_OPTIONS[key];
  if (meta.type === "bool") return value ? "True" : "False";
  if (meta.type === "int") return String(Math.trunc(Number(value)));
  return Number(value).toFixed(6);
}
