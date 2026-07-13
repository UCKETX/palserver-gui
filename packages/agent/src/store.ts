import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WorldSettingsSchema, type WorldSettings, type EngineSettings, type LaunchOptions } from "@palserver/shared";
import { DATA_DIR } from "./env.js";

export interface InstanceRecord {
  id: string;
  name: string;
  backend: "native" | "docker" | "k8s";
  flavor: "vanilla" | "modded";
  gamePort: number;
  /** Steam 查詢埠(UDP)。Palworld 每台預設都用 27015、且不在 PalWorldSettings.ini
   * 裡,所以同一台開第二台一定撞(第二台綁不到就死在開機)。每台自動分配唯一值,
   * 啟動時以 -queryport + Engine.ini GameServerQueryPort 兩管道套用。 */
  queryPort?: number;
  /** docker only: 自訂容器鏡像;undefined = 用內建 IMAGES[flavor]。 */
  dockerImage?: string;
  /** native only: custom server root; undefined = agent-managed install
   * under instanceDir/server. */
  serverDir?: string;
  /** true = the agent installed (and may re-download) the server at
   * serverDir; false/undefined = adopted pre-existing install, never
   * auto-installed into. */
  serverDirManaged?: boolean;
  settings: WorldSettings;
  /** 受管理的 Engine.ini 微調(效能/網路)。store 是這些值的權威來源:伺服器關機時
   * 會把 Engine.ini 重寫回預設,所以不能只靠檔案。每次啟動前會把這裡的值合併回
   * Engine.ini(見 native.ts writeIni),GUI 顯示也讀這裡而非讀檔。 */
  engineSettings?: EngineSettings;
  /** 命令列啟動參數(launch options);啟動時由 buildLaunchArgs 組成 -flag。 */
  launchOptions?: LaunchOptions;
  createdAt: string;
  /** k8s backend: namespace of the game server StatefulSet. */
  k8sNamespace?: string;
  /** k8s backend: name of the game server StatefulSet. */
  k8sStatefulSet?: string;
  /** k8s backend: ClusterIP Service name for REST API access. */
  k8sServiceName?: string;
}

const STORE_FILE = path.join(DATA_DIR, "instances.json");

/** Steam 查詢埠的分配起點(Palworld 預設值);往上遞增找沒被占用的。 */
const QUERY_PORT_BASE = 27015;

/**
 * Flat-file store for instance metadata. Container state lives in Docker
 * (labels + inspect); this file is the source of truth for settings only.
 */
export class InstanceStore {
  private instances = new Map<string, InstanceRecord>();

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      const raw: InstanceRecord[] = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      for (const rec of raw) {
        // Migrate settings saved by older schema versions: fill new options
        // with defaults, drop keys we no longer know. 用 safeParse 兜底:即使整筆
        // settings 壞掉(null / 非物件),也退回全預設而非讓整個 agent 開機崩潰。
        // (欄位級的超範圍/髒值由 schema 的 .catch 各自退回預設,見 zodFor。)
        const parsed = WorldSettingsSchema.safeParse(rec.settings ?? {});
        rec.settings = parsed.success ? parsed.data : WorldSettingsSchema.parse({});
        // Records created before the native backend existed were docker-based.
        rec.backend ??= "docker";
        this.instances.set(rec.id, rec);
      }
      // 回填既有實例的 Steam 查詢埠:早於這個欄位建立的實例都沒有,補上唯一值,
      // 否則多台一起開仍會全部搶 27015。下次啟動就會用到新分配的埠。
      const used = new Set(
        [...this.instances.values()].map((r) => r.queryPort).filter((p): p is number => !!p),
      );
      let next = QUERY_PORT_BASE;
      for (const rec of this.instances.values()) {
        if (rec.queryPort == null) {
          while (used.has(next)) next++;
          rec.queryPort = next;
          used.add(next);
        }
      }
      this.flush();
    }
  }

  /** 分配一個沒被別台占用的 Steam 查詢埠(建立實例時用)。 */
  nextQueryPort(): number {
    const used = new Set(
      this.list().map((r) => r.queryPort).filter((p): p is number => !!p),
    );
    let port = QUERY_PORT_BASE;
    while (used.has(port)) port++;
    return port;
  }

  list(): InstanceRecord[] {
    return [...this.instances.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  get(id: string): InstanceRecord | undefined {
    return this.instances.get(id);
  }

  findByName(name: string): InstanceRecord | undefined {
    return this.list().find((r) => r.name === name);
  }

  create(rec: Omit<InstanceRecord, "id" | "createdAt">): InstanceRecord {
    const full: InstanceRecord = {
      ...rec,
      id: crypto.randomBytes(6).toString("hex"),
      createdAt: new Date().toISOString(),
    };
    this.instances.set(full.id, full);
    this.flush();
    return full;
  }

  update(
    id: string,
    patch: Partial<Pick<InstanceRecord, "settings" | "serverDir" | "serverDirManaged" | "engineSettings" | "launchOptions" | "queryPort">>,
  ): InstanceRecord {
    const rec = this.instances.get(id);
    if (!rec) throw new Error(`instance ${id} not found`);
    const next = { ...rec, ...patch };
    this.instances.set(id, next);
    this.flush();
    return next;
  }

  remove(id: string): void {
    this.instances.delete(id);
    this.flush();
  }

  /** Per-instance directory bind-mounted into the container. */
  instanceDir(id: string): string {
    return path.join(DATA_DIR, "instances", id);
  }

  private flush(): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.list(), null, 2));
  }
}
