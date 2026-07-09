import { useCallback, useEffect, useState } from "react";
import { GiShield, GiScrollUnfurled } from "react-icons/gi";
import { FiDownload, FiCheck, FiPackage, FiFolder } from "react-icons/fi";
import type { ModComponent, ModsStatus } from "@palserver/shared";
import type { AgentClient } from "./api";
import { FileManager } from "./FileManager";
import { btn, btnGhost, card, errorCls } from "./ui";

const COMPONENTS: {
  id: ModComponent;
  title: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "paldefender",
    title: "PalDefender 反外掛",
    desc: "伺服器端驗證,防止已知外掛、漏洞與惡意崩潰(前身為 Palguard)。安裝後啟動一次伺服器會自動生成設定檔。",
    icon: <GiShield className="size-8 text-pal" />,
  },
  {
    id: "ue4ss",
    title: "UE4SS 模組載入器",
    desc: "Lua / Blueprint 模組的執行環境。安裝後即可在下方管理 Lua 模組。",
    icon: <GiScrollUnfurled className="size-8 text-pal" />,
  },
];

export function ModsTab({ client, instanceId }: { client: AgentClient; instanceId: string }) {
  const [mods, setMods] = useState<ModsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMods(await client.mods(instanceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (component: ModComponent) => {
    setBusy(component);
    setError(null);
    try {
      await client.installMod(instanceId, component);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (name: string, enabled: boolean) => {
    try {
      setMods(await client.toggleLuaMod(instanceId, name, enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!mods) return <p className="text-ink-muted">{error ?? "載入中…"}</p>;

  if (!mods.supported) {
    return (
      <div className="rounded-(--radius-cute) border-2 border-dashed border-line px-6 py-12 text-center text-ink-muted">
        <FiPackage className="mx-auto mb-2 size-11" />
        {mods.reason}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className={errorCls}>{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {COMPONENTS.map((c) => {
          const state = mods[c.id];
          return (
            <div key={c.id} className={card}>
              <div className="flex items-start gap-3">
                {c.icon}
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-extrabold">{c.title}</h3>
                    {state.installed && (
                      <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-grass/40 bg-grass/15 px-3 py-1 text-xs font-bold text-grass">
                        <FiCheck className="size-3.5" />
                        已安裝{state.version ? ` ${state.version}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-ink-muted">{c.desc}</p>
                  <div className="mt-3">
                    <button
                      className={`${btn} inline-flex items-center gap-1.5`}
                      onClick={() => install(c.id)}
                      disabled={busy !== null}
                    >
                      <FiDownload className="size-4" />
                      {busy === c.id ? "安裝中…" : state.installed ? "更新到最新版" : "安裝"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[13px] text-ink-muted">安裝或更新後,重啟伺服器才會生效。</p>

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-ink-muted">Lua 模組(UE4SS)</h3>
          <button
            className={`${btnGhost} inline-flex items-center gap-1.5`}
            onClick={() => setBrowsing("Pal/Binaries/Win64")}
          >
            <FiFolder className="size-4" /> 開啟模組資料夾
          </button>
        </div>
        {mods.luaMods.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            尚無 Lua 模組。安裝 UE4SS 後,用上方的「開啟模組資料夾」上傳模組,或把資料夾放進
            <code className="mx-1 rounded bg-card-soft px-1.5 py-0.5 text-xs">Pal\Binaries\Win64\ue4ss\Mods</code>
            。
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {mods.luaMods.map((m) => (
              <div key={m.name} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-bold">{m.name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={m.enabled}
                  onClick={() => toggle(m.name, !m.enabled)}
                  className={`relative h-7 w-12 rounded-full transition ${m.enabled ? "bg-grass" : "bg-line"}`}
                >
                  <span
                    className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${m.enabled ? "left-6" : "left-1"}`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-ink-muted">Pak 模組</h3>
          <button
            className={`${btnGhost} inline-flex items-center gap-1.5`}
            onClick={() => setBrowsing("Pal/Content/Paks")}
          >
            <FiFolder className="size-4" /> 開啟 Paks 資料夾
          </button>
        </div>
        {mods.pakMods.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            尚無 Pak 模組。用上方的「開啟 Paks 資料夾」上傳 .pak 檔(Blueprint 模組放 LogicMods 子資料夾)。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {mods.pakMods.map((name) => (
              <li key={name} className="text-sm font-bold">
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-ink-muted">伺服器檔案</h3>
          <button
            className={`${btnGhost} inline-flex items-center gap-1.5`}
            onClick={() => setBrowsing("")}
          >
            <FiFolder className="size-4" /> 瀏覽全部
          </button>
        </div>
        <p className="text-[13px] text-ink-muted">
          直接編輯、上傳或刪除伺服器目錄裡的檔案(例如 PalDefender 的 Config.json)。
        </p>
      </div>

      {browsing !== null && (
        <FileBrowserDialog
          client={client}
          instanceId={instanceId}
          initialPath={browsing}
          onClose={() => {
            setBrowsing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function FileBrowserDialog({
  client,
  instanceId,
  initialPath,
  onClose,
}: {
  client: AgentClient;
  instanceId: string;
  initialPath: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[rgb(35_32_48/0.55)] p-6 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className={`${card} my-auto flex w-[860px] max-w-full flex-col gap-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">檔案管理</h2>
          <button className={btnGhost} onClick={onClose}>
            關閉
          </button>
        </div>
        <FileManager client={client} instanceId={instanceId} initialPath={initialPath} />
      </div>
    </div>
  );
}
