import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiDownload, FiPackage, FiRefreshCw } from "react-icons/fi";
import type { VersionStatus } from "@palserver/shared";
import type { AgentClient } from "./api";
import { btn, btnGhost, card, errorCls } from "./ui";

/** Installed game version and whether Steam has a newer build. */
export function VersionCard({
  client,
  instanceId,
  running,
  onUpdateStarted,
}: {
  client: AgentClient;
  instanceId: string;
  running: boolean;
  onUpdateStarted: () => void;
}) {
  const [version, setVersion] = useState<VersionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setVersion(await client.version(instanceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!version) return null;

  const update = async () => {
    if (!confirm("更新會重新下載伺服器檔案(數 GB),期間伺服器無法啟動。\n\n確定要更新嗎?")) return;
    setBusy(true);
    setError(null);
    try {
      await client.updateServer(instanceId);
      onUpdateStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-extrabold text-ink-muted">
        <FiPackage className="size-4 text-pal" /> 遊戲版本
      </h3>

      {error && <p className={`mb-3 ${errorCls}`}>{error}</p>}

      <dl className="flex flex-col gap-2">
        <Row label="伺服器版本" value={version.gameVersion ?? "未知(啟動一次伺服器即可取得)"} />
        {version.installedBuild && (
          <Row label="已安裝建置" value={version.installedBuild} mono />
        )}
        {version.latestBuild && <Row label="最新建置" value={version.latestBuild} mono />}
        {version.latestUpdatedAt && (
          <Row label="官方更新時間" value={new Date(version.latestUpdatedAt).toLocaleString()} />
        )}
      </dl>

      <div className="mt-3">
        {version.updateAvailable === true ? (
          <div className="rounded-xl border-2 border-sun/40 bg-sun/10 p-3">
            <p className="text-[13px] font-bold text-sun">
              有新版本可更新。更新前建議先到「存檔備份」建立一份備份。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className={`${btn} inline-flex items-center gap-1.5`}
                onClick={update}
                disabled={busy || running}
                title={running ? "請先停止伺服器" : undefined}
              >
                <FiDownload className="size-4" /> {busy ? "啟動更新中…" : "立即更新"}
              </button>
              {running && <span className="text-xs text-ink-muted">請先停止伺服器</span>}
            </div>
          </div>
        ) : version.updateAvailable === false ? (
          <p className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-grass/40 bg-grass/15 px-3 py-1 text-xs font-bold text-grass">
            <FiCheck className="size-3.5" /> 已是最新版本
          </p>
        ) : (
          <p className="text-[13px] text-ink-muted">
            {version.reason ?? "無法判斷是否有新版本(可能連不上 Steam)。"}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className={`${btnGhost} inline-flex items-center gap-1.5`} onClick={refresh}>
          <FiRefreshCw className="size-3.5" /> 重新檢查
        </button>
        {version.checkedAt && (
          <span className="text-xs text-ink-muted">
            版本資訊取得於 {new Date(version.checkedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className={`text-right font-bold break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
