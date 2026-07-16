/**
 * 進階功能目錄與可用性判斷(agent 與 web 共用)。
 *
 * 目錄保留穩定的功能 id,供前後端共用；目前所有功能均免費開放,不需要識別碼。
 */

export interface EarlyAccessFeature {
  id: string;
  label: string;
}

export const EARLY_ACCESS_FEATURES: EarlyAccessFeature[] = [
  { id: "custom-pal", label: "自訂帕魯(詞條 / 體質 / 星星)" },
  { id: "guild-map", label: "地圖公會詳情(名稱 / 成員 / 據點)" },
  { id: "pal-stats", label: "帕魯物種數值編輯器(PalSchema:HP / 攻防 / 首領)" },
  { id: "bulk-items", label: "批量給予道具(物品選單 + 數量)" },
  { id: "teleport", label: "傳送玩家(玩家 / 地圖座標描點)" },
  { id: "log-tools", label: "日誌重點標記與格式化(事件上色 + 易讀套版)" },
  { id: "dashboard-stats", label: "首頁進階顯示(在線玩家 / 資源用量一覽)" },
  { id: "save-slim", label: "存檔健檢(組成分析 / 殘留統計)" },
  { id: "leaderboard", label: "伺服器排行榜(等級 / 財富 / 圖鑑 / 最強帕魯 + 掃描差異週報)" },
];

/** 所有功能目前均對所有使用者免費。 */
export function featureFreeNow(_id: string): boolean {
  return true;
}

/** agent 回報給前端的授權狀態。 */
export interface LicenseStatus {
  /** 使用者是否已填識別碼。 */
  hasKey: boolean;
  /** 識別碼目前是否有效(含離線寬限期內)。 */
  valid: boolean;
  tier: string | null;
  /** 這張識別碼解鎖的早鳥功能 id。 */
  features: string[];
  /** 到期日(ISO)或 null=永久。 */
  expiresAt: string | null;
  /** 無效原因:invalid / bound-to-another / expired / offline / server-error。 */
  reason: string | null;
  /** 這台伺服器的機器碼(短)—— 識別碼一旦啟用就綁這台。 */
  machineId: string;
  /** 上次向伺服器驗證的時間(ISO);離線時前端可提示。 */
  checkedAt: string | null;
}

/**
 * 統一的功能可用性判斷。保留授權參數以維持既有 API 相容性。
 */
export function hasFeature(id: string, _lic: Pick<LicenseStatus, "valid" | "features">): boolean {
  return featureFreeNow(id);
}
