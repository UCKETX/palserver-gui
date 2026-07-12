import { useEffect, useState } from "react";
import { FiX, FiCpu, FiPackage, FiTrendingUp, FiZap, FiShield } from "react-icons/fi";
import { GiShield } from "react-icons/gi";
import type { PlayerDetail, PdRestStatus } from "@palserver/shared";
import type { AgentClient } from "./api";
import { useGameData, displayName, palIconUrl, itemIconUrl, type GameData } from "./gameData";
import { maskSteamId } from "./SteamId";
import { t, useI18n } from "./i18n";
import { Overlay, card, btn, btnGhost, errorCls } from "./ui";

/** Full detail for one player — pals and inventory — via PalDefender's REST
 * API. Shows a clear prompt when that API isn't available. Player actions live
 * in the list rows (PlayerActionsMenu), not here. */
export function PlayerDetailModal({
  client,
  instanceId,
  identifier,
  displayLabel,
  onClose,
  onGoToPalDefender,
}: {
  client: AgentClient;
  instanceId: string;
  identifier: string;
  displayLabel: string;
  onClose: () => void;
  /** Jump to the PalDefender tab so the user can enable REST + set a token. */
  onGoToPalDefender?: () => void;
}) {
  useI18n();
  const gameData = useGameData();
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [rest, setRest] = useState<PdRestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .playerDetail(instanceId, identifier)
      .then((d) => {
        setDetail(d);
        // 查不到就順手抓 REST 狀態,判斷原因是「沒啟用 / 沒 token」還是伺服器沒開。
        if (!d.available) client.palDefenderRest(instanceId).then(setRest).catch(() => {});
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        client.palDefenderRest(instanceId).then(setRest).catch(() => {});
      });
  }, [client, instanceId, identifier]);

  // PalDefender 有裝、但 REST 還沒「啟用 + 有 token」→ 引導使用者去 PalDefender 分頁設定。
  const needsRestSetup = !!rest?.installed && !(rest.enabled && rest.hasToken);

  return (
    <Overlay onClose={onClose}>
      <div
        className={`${card} flex max-h-[85vh] w-[720px] max-w-full flex-col gap-4 overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-lg font-extrabold">{displayLabel}</h2>
          <button className={btnGhost} onClick={onClose}>
            <FiX className="inline size-4" /> {t("關閉")}
          </button>
        </div>

        {error && <p className={errorCls}>{error}</p>}
        {!detail && !error && <p className="text-ink-muted">{t("載入中…")}</p>}

        {detail && !detail.available && (
          <div className="rounded-(--radius-cute) border-2 border-dashed border-line px-6 py-8 text-center text-ink-muted">
            <GiShield className="mx-auto mb-2 size-11" />
            <p className="font-bold">{t("無法讀取玩家細節")}</p>
            <p className="mt-1 text-[13px]">{detail.reason}</p>

            {needsRestSetup ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <p className="text-[13px]">
                  {t("玩家細節需要 PalDefender 的 REST API。請到 PalDefender 分頁啟用 REST API 並建立存取權杖。")}
                </p>
                <p className="text-xs text-sun">
                  {t("啟用或變更後,需要重啟伺服器一次才會生效。")}
                </p>
                {onGoToPalDefender && (
                  <button
                    className={`${btn} inline-flex items-center gap-1.5`}
                    onClick={() => {
                      onClose();
                      onGoToPalDefender();
                    }}
                  >
                    <FiShield className="size-4" /> {t("前往 PalDefender 設定")}
                  </button>
                )}
              </div>
            ) : rest && !rest.installed ? (
              <p className="mt-2 text-xs">
                {t("玩家細節需要安裝 PalDefender 並啟用其 REST API。PalDefender 1.8.0 以上連離線玩家也能查詢。")}
              </p>
            ) : null}
          </div>
        )}

        {detail?.available && <DetailBody detail={detail} gameData={gameData} />}
      </div>
    </Overlay>
  );
}

function DetailBody({ detail, gameData }: { detail: PlayerDetail; gameData: GameData | null }) {
  const team = detail.pals.filter((p) => p.location === "team");
  const palbox = detail.pals.filter((p) => p.location === "palbox");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Info label={t("名稱")} value={detail.name || "—"} />
        <Info label={t("公會")} value={detail.guildName || t("無")} />
        <Info label="UserId" value={detail.userId ? maskSteamId(detail.userId) : "—"} />
        {detail.progression && <Info label={t("等級")} value={`Lv.${detail.progression.level}`} />}
        <Info label={t("隊伍帕魯")} value={String(detail.teamCount)} />
        <Info label={t("帕魯箱")} value={String(detail.palboxCount)} />
      </div>

      {detail.progression && <Progression prog={detail.progression} />}
      {detail.techs && (
        <div>
          <h3 className="mb-1 inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-muted">
            <FiCpu className="size-4 text-pal" /> {t("已解鎖科技")}
          </h3>
          <p className="text-[13px]">
            {t("{n} / {total} 項", { n: detail.techs.unlockedCount, total: detail.techs.totalCount })}
          </p>
        </div>
      )}

      {team.length > 0 && <PalGroup title={t("隊伍")} pals={team} gameData={gameData} />}
      {palbox.length > 0 && <PalGroup title={t("帕魯箱")} pals={palbox} gameData={gameData} />}
      {detail.pals.length === 0 && (
        <p className="text-[13px] text-ink-muted">{t("沒有讀取到帕魯資料。")}</p>
      )}

      <ItemList items={detail.items} gameData={gameData} />
    </div>
  );
}

/** 進度概要:等級/經驗、科技點、頭目、捕捉(PalDefender /progression)。 */
function Progression({ prog }: { prog: NonNullable<PlayerDetail["progression"]> }) {
  const rows: [string, string][] = [
    [t("經驗值"), prog.exp.toLocaleString()],
    [t("未分配狀態點"), String(prog.unusedStatusPoints)],
    [t("科技點數"), String(prog.technologyPoints)],
    [t("古代科技點數"), String(prog.ancientTechnologyPoints)],
    [t("擊敗頭目"), String(prog.bossesDefeated)],
    [t("捕捉帕魯種類"), String(prog.palsCaptured)],
  ];
  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-muted">
        <FiTrendingUp className="size-4 text-pal" /> {t("進度")}
      </h3>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <Info key={k} label={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="font-bold break-all">{value}</p>
    </div>
  );
}

function PalGroup({
  title,
  pals,
  gameData,
}: {
  title: string;
  pals: PlayerDetail["pals"];
  gameData: GameData | null;
}) {
  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-muted">
        <FiZap className="size-4 text-pal" /> {title}({pals.length})
      </h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {pals.map((p) => {
          const entity = gameData?.palById.get(p.palId);
          return (
            <div key={p.instanceId} className="flex items-center gap-2 rounded-xl border-2 border-line p-2">
              {entity?.icon ? (
                <img src={palIconUrl(entity.icon)} alt="" className="size-9 shrink-0" />
              ) : (
                <span className="size-9 shrink-0 rounded bg-card-soft" />
              )}
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold">
                  {p.nickname || (entity ? displayName(entity) : p.palId)}
                  {p.shiny && <span className="ml-1 text-amber-500">✦</span>}
                </p>
                <p className="text-xs text-ink-muted">Lv.{p.level}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemList({
  items,
  gameData,
}: {
  items: PlayerDetail["items"];
  gameData: GameData | null;
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-ink-muted">{t("沒有讀取到背包資料。")}</p>;
  }
  // Merge same item across containers for a cleaner overview.
  const merged = new Map<string, number>();
  for (const s of items) merged.set(s.itemId, (merged.get(s.itemId) ?? 0) + s.count);
  const rows = [...merged.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-muted">
        <FiPackage className="size-4 text-pal" /> {t("背包({n} 種)", { n: rows.length })}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {rows.map(([itemId, count]) => {
          const entity = gameData?.itemById.get(itemId);
          return (
            <div key={itemId} className="flex items-center gap-2 rounded-xl border-2 border-line p-2">
              {entity?.icon ? (
                <img src={itemIconUrl(entity.icon)} alt="" className="size-8 shrink-0" />
              ) : (
                <span className="size-8 shrink-0 rounded bg-card-soft" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">
                  {entity ? displayName(entity) : itemId}
                </p>
              </div>
              <span className="shrink-0 text-sm font-extrabold text-pal">×{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
