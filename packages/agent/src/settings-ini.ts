import { WORLD_OPTIONS, type WorldSettings, type WorldOptionKey } from "@palserver/shared";

/**
 * Serialize structured settings into PalWorldSettings.ini.
 * Format: one OptionSettings=(Key=Value,...) tuple under the
 * [/Script/Pal.PalGameWorldSettings] section. Value formatting follows the
 * game's own DefaultPalWorldSettings.ini: floats get 6 decimals, enums are
 * emitted raw, free-form strings are double-quoted.
 */
export function renderPalWorldSettingsIni(settings: WorldSettings): string {
  const parts = (Object.keys(WORLD_OPTIONS) as WorldOptionKey[])
    .filter((key) => key in settings)
    .map((key) => {
      const meta = WORLD_OPTIONS[key];
      const value = settings[key];
      switch (meta.type) {
        case "bool":
          return `${key}=${value ? "True" : "False"}`;
        case "int":
          return `${key}=${Math.trunc(Number(value))}`;
        case "float":
          return `${key}=${Number(value).toFixed(6)}`;
        case "enum":
          return `${key}=${value}`;
        case "string":
          return `${key}=${JSON.stringify(String(value))}`;
      }
    });
  return [
    "[/Script/Pal.PalGameWorldSettings]",
    `OptionSettings=(${parts.join(",")})`,
    "",
  ].join("\n");
}

/**
 * Parse a PalWorldSettings.ini file back into a structured WorldSettings object.
 * Extracts Key=Value pairs from the OptionSettings=(...) tuple and coerces
 * each value to the correct type based on WORLD_OPTIONS metadata.
 */
export function parsePalWorldSettingsIni(ini: string): Partial<WorldSettings> {
  const m = /OptionSettings=\(([\s\S]*)\)/.exec(ini);
  if (!m) return {};
  const raw = m[1];
  const result: Record<string, unknown> = {};
  // Split on commas that are not inside quotes or parentheses
  const pairs = raw.match(/(\w+)=("[^"]*"|\([^)]*\)|[^,]+)/g) ?? [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    let value: string = pair.slice(eq + 1).trim();
    // Unquote strings
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (!(key in WORLD_OPTIONS)) continue;
    const meta = WORLD_OPTIONS[key as WorldOptionKey];
    switch (meta.type) {
      case "bool":
        result[key] = value.toLowerCase() === "true";
        break;
      case "int":
        result[key] = Math.trunc(Number(value));
        break;
      case "float":
        result[key] = Number(value);
        break;
      case "enum":
      case "string":
        result[key] = value;
        break;
    }
  }
  return result as Partial<WorldSettings>;
}
