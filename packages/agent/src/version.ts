import fs from "node:fs";
import path from "node:path";
import type { VersionStatus } from "@palserver/shared";
import { DATA_DIR } from "./env.js";
import type { DriverContext } from "./driver.js";
import type { InstanceRecord } from "./store.js";
import { serverRoot } from "./native.js";
import { rest } from "./restapi.js";
import { rconExec } from "./rcon.js";

/**
 * Version reporting for native instances.
 *
 * "Installed" comes from the manifest ids DepotDownloader leaves behind in
 * `.DepotDownloader/<depotId>_<manifestId>.manifest` — readable whether or
 * not the server is running. "Latest" comes from the public branch on Steam
 * (via api.steamcmd.net, which needs no key). Comparing manifest ids per
 * depot is exact: a mismatch means the depot's content changed.
 *
 * The friendly game version ("v0.7.2") only exists in the server's own REST
 * /info, so it is cached per instance whenever the server is reachable.
 */

const APP_ID = "2394010";
const STEAM_INFO_URL = `https://api.steamcmd.net/v1/info/${APP_ID}`;
const LATEST_TTL_MS = 30 * 60_000;
const LATEST_CACHE = path.join(DATA_DIR, `steam-app-${APP_ID}.json`);

/** Depots that ship the Steamworks redistributable, not game content. */
const SDK_DEPOTS = new Set(["1004", "1005", "1006", "228989"]);

interface LatestInfo {
  buildId: string;
  updatedAt: string | null;
  /** depotId → manifest id on the public branch */
  manifests: Record<string, string>;
  fetchedAt: string;
}

let latestMemo: LatestInfo | null = null;

function readLatestCache(): LatestInfo | null {
  try {
    return JSON.parse(fs.readFileSync(LATEST_CACHE, "utf8"));
  } catch {
    return null;
  }
}

/** Latest public-branch info, memoized for 30 min and cached on disk so an
 * offline agent still shows the last known state instead of nothing. */
export async function fetchLatest(force = false): Promise<LatestInfo | null> {
  const cached = latestMemo ?? readLatestCache();
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < LATEST_TTL_MS) {
    latestMemo = cached;
    return cached;
  }
  try {
    const res = await fetch(STEAM_INFO_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      data: Record<
        string,
        {
          depots: Record<string, unknown> & {
            branches?: { public?: { buildid?: string; timeupdated?: string } };
          };
        }
      >;
    };
    const app = body.data[APP_ID];
    const branch = app.depots.branches?.public;
    const manifests: Record<string, string> = {};
    for (const [depotId, depot] of Object.entries(app.depots)) {
      if (!/^\d+$/.test(depotId) || typeof depot !== "object" || depot === null) continue;
      const pub = (depot as { manifests?: { public?: { gid?: string } | string } }).manifests?.public;
      const gid = typeof pub === "string" ? pub : pub?.gid;
      if (gid) manifests[depotId] = gid;
    }
    const info: LatestInfo = {
      buildId: branch?.buildid ?? "",
      updatedAt: branch?.timeupdated
        ? new Date(Number(branch.timeupdated) * 1000).toISOString()
        : null,
      manifests,
      fetchedAt: new Date().toISOString(),
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LATEST_CACHE, JSON.stringify(info, null, 2));
    latestMemo = info;
    return info;
  } catch {
    return cached; // stale is better than blank
  }
}

/** depotId → manifest id, as installed on disk. */
export function installedManifests(root: string): Record<string, string> {
  const dir = path.join(root, ".DepotDownloader");
  const result: Record<string, string> = {};
  try {
    for (const name of fs.readdirSync(dir)) {
      const match = /^(\d+)_(\d+)\.manifest$/.exec(name);
      if (match) result[match[1]] = match[2];
    }
  } catch {
    /* not an agent-managed install (e.g. adopted from Steam) */
  }
  return result;
}

const versionCacheFile = (ctx: DriverContext) => path.join(ctx.instanceDir, "version.json");

function readGameVersion(ctx: DriverContext): string | null {
  try {
    return JSON.parse(fs.readFileSync(versionCacheFile(ctx), "utf8")).gameVersion ?? null;
  } catch {
    return null;
  }
}

function writeGameVersion(ctx: DriverContext, gameVersion: string): void {
  fs.mkdirSync(ctx.instanceDir, { recursive: true });
  fs.writeFileSync(versionCacheFile(ctx), JSON.stringify({ gameVersion }, null, 2));
}

/** Compare content depots only; SDK depots move on their own schedule. */
function compare(
  installed: Record<string, string>,
  latest: Record<string, string>,
): { updateAvailable: boolean | null; installedBuild: string | null } {
  const contentDepots = Object.keys(installed).filter((d) => !SDK_DEPOTS.has(d));
  if (contentDepots.length === 0) return { updateAvailable: null, installedBuild: null };

  const comparable = contentDepots.filter((d) => latest[d]);
  const installedBuild = installed[contentDepots[0]] ?? null;
  if (comparable.length === 0) return { updateAvailable: null, installedBuild };

  return {
    updateAvailable: comparable.some((d) => installed[d] !== latest[d]),
    installedBuild,
  };
}

/**
 * The game's own version string ("v0.7.2"). The REST API reports it directly;
 * RCON's `Info` embeds it in "Welcome to Pal Server[v0.7.2]", which covers
 * servers that expose RCON but not REST.
 */
async function liveGameVersion(rec: InstanceRecord): Promise<string | null> {
  const info = await rest.info(rec).catch(() => null);
  if (info?.version) return info.version;

  const output = await rconExec(rec, "Info").catch(() => null);
  return output?.match(/\[(v[\d.]+)\]/)?.[1] ?? null;
}

/** Cheap, no network: used when listing instances. */
export function cachedVersionSummary(
  rec: InstanceRecord,
  ctx: DriverContext,
): { gameVersion: string | null; updateAvailable: boolean | null } {
  if (rec.backend !== "native") {
    // docker/k8s: 版本來自 REST API（同步由 getVersionStatus 寫入快取），無 manifest 比對
    return { gameVersion: readGameVersion(ctx), updateAvailable: null };
  }
  const latest = latestMemo ?? readLatestCache();
  const installed = installedManifests(serverRoot(rec, ctx));
  return {
    gameVersion: readGameVersion(ctx),
    updateAvailable: latest ? compare(installed, latest.manifests).updateAvailable : null,
  };
}

export async function getVersionStatus(
  rec: InstanceRecord,
  ctx: DriverContext,
): Promise<VersionStatus> {
  if (rec.backend !== "native") {
    // docker/k8s: 版本來自 REST API，無 manifest 比對（manifest 在容器/Pod 內）
    const live = await liveGameVersion(rec);
    return {
      supported: true,
      reason: live ? undefined : "伺服器未運行中，無法取得版本",
      gameVersion: live,
      installedBuild: null,
      latestBuild: null,
      latestUpdatedAt: null,
      updateAvailable: null,
      checkedAt: null,
    };
  }

  // Refresh the friendly version whenever the server is up; otherwise reuse
  // whatever we last saw.
  let gameVersion = readGameVersion(ctx);
  const live = await liveGameVersion(rec);
  if (live) {
    gameVersion = live;
    writeGameVersion(ctx, gameVersion);
  }

  const latest = await fetchLatest();
  const installed = installedManifests(serverRoot(rec, ctx));
  const { updateAvailable, installedBuild } = latest
    ? compare(installed, latest.manifests)
    : { updateAvailable: null, installedBuild: installedManifests(serverRoot(rec, ctx))["2394011"] ?? null };

  return {
    supported: true,
    reason:
      installedBuild === null
        ? "找不到安裝資訊(收編的伺服器可能由 Steam 管理),無法比對版本"
        : undefined,
    gameVersion,
    installedBuild,
    latestBuild: latest?.manifests["2394011"] ?? latest?.buildId ?? null,
    latestUpdatedAt: latest?.updatedAt ?? null,
    updateAvailable,
    checkedAt: latest?.fetchedAt ?? null,
  };
}
