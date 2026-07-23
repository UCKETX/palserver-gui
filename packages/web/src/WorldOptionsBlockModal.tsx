import { useState } from "react";
import { FiAlertTriangle } from "react-icons/fi";
import type { AgentClient } from "./api";
import { t, useI18n } from "./i18n";
import { Overlay, btn, card, errorCls } from "./ui";

/**
 * 啟動伺服器時偵測到當前世界有 WorldOptions.sav 就跳這個「硬限制」modal:
 * 它會覆蓋 PalWorldSettings.ini(含 AdminPassword),多半是四人(連線)存檔搬上專用伺服器
 * 遺留下來的,導致世界設定不生效、管理員密碼對不上。唯一關閉方式 = 按刪除鍵(移除該檔後續啟)。
 * 移除採「改名備份」(.disabled-<時間>,可還原),與 SavesTab 的停用同一支後端;世界/玩家/帕魯
 * 資料都在別的檔案,不受影響。
 */
export function WorldOptionsBlockModal({
  client,
  instanceId,
  worldGuid,
  onResolved,
}: {
  client: AgentClient;
  instanceId: string;
  worldGuid: string;
  onResolved: () => void;
}) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeAndContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.disableWorldOptions(instanceId, worldGuid);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={() => {}}>
      <div
        className={`${card} flex max-h-[90vh] w-[480px] max-w-full flex-col gap-3 overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="inline-flex items-center gap-2 text-lg font-extrabold text-berry">
          <FiAlertTriangle className="size-5" /> {t("偵測到存檔設定衝突(WorldOptions.sav)")}
        </h2>
        <p className="text-[13px] text-ink-muted">
          {t("從四人(連線)存檔搬過來的玩家,可能遇到:")}
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] font-bold text-ink">
          <li>{t("世界設定(PalWorldSettings.ini)無法正確套用")}</li>
          <li>{t("已設定管理員密碼,玩家列表卻顯示「管理員密碼不符」")}</li>
        </ul>
        <p className="rounded-xl bg-berry/10 px-3 py-2 text-[13px] font-bold text-berry">
          {t("這是四人存檔遺留的 WorldOptions.sav 覆蓋掉伺服器設定檔造成的。要正常啟動,必須先移除這個檔案。")}
        </p>
        <p className="text-[13px] text-ink-muted">
          {t("按下方按鈕會移除該檔(自動改名備份為 .disabled 檔,可還原)後繼續啟動伺服器。世界、玩家、帕魯資料都在別的檔案,不受影響(僅玩家重生點可能需重選)。")}
        </p>
        <p className="text-[12px] text-ink-muted">
          {t("註:若你是刻意用這個檔案設定 PalWorldSettings.ini 無法調整的參數,移除後那些設定會被打回 ini/預設值。")}
        </p>
        {error && <p className={errorCls}>{error}</p>}
        <div className="flex">
          <button className={btn} onClick={removeAndContinue} disabled={busy}>
            {busy ? t("處理中…") : t("刪除 WorldOptions.sav 並繼續啟動")}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
