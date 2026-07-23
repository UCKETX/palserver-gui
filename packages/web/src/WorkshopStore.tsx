import { useCallback, useEffect, useState } from "react";
import {
  FiCheckCircle,
  FiDownloadCloud,
  FiExternalLink,
  FiKey,
  FiLogIn,
  FiRefreshCw,
  FiSearch,
  FiUsers,
} from "react-icons/fi";
import type { Backend } from "@palserver/shared";
import type { AgentClient, WorkshopItem, WorkshopSearchResult, WorkshopStatus } from "./api";
import { t, useI18n } from "./i18n";
import { btn, btnGhost, card, errorCls, inputCls } from "./ui";

type Sort = "popular" | "trend" | "new" | "updated";

function formatCount(value?: number): string {
  if (!value) return "0";
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}

function formatDate(value?: number): string {
  return value ? new Date(value * 1000).toLocaleDateString() : "";
}

export function WorkshopStore({
  client,
  instanceId,
  backend,
  running,
  onInstalled,
}: {
  client: AgentClient;
  instanceId: string;
  backend: Backend;
  running: boolean;
  onInstalled?: () => void;
}) {
  useI18n();
  const [status, setStatus] = useState<WorkshopStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [account, setAccount] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [results, setResults] = useState<WorkshopSearchResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    client.workshopStatus().then((next) => {
      setStatus(next);
      setAccount(next.accountName ?? "");
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [client]);

  const search = useCallback(async (cursor?: string) => {
    setBusy(cursor ? "more" : "search");
    setError(null);
    try {
      const next = await client.searchWorkshop(instanceId, { query: query.trim(), sort, cursor, pageSize: 18 });
      setResults((current) => cursor && current
        ? { ...next, items: [...current.items, ...next.items] }
        : next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [client, instanceId, query, sort]);

  const saveKey = async () => {
    setBusy("key");
    setError(null);
    try {
      const next = await client.setWorkshopApiKey(apiKey);
      setStatus(next);
      setApiKey("");
      setNotice(t("Steam Web API Key 已儲存。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const startLogin = async () => {
    setBusy("login");
    setError(null);
    setNotice(null);
    try {
      setStatus(await client.startWorkshopLogin(account));
      setNotice(t("SteamCMD 視窗已開啟;請在該視窗輸入密碼與 Steam Guard,完成後輸入 quit。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const verifyLogin = async () => {
    setBusy("verify");
    setError(null);
    try {
      const next = await client.verifyWorkshopLogin(account || undefined);
      setStatus(next);
      setAccount(next.accountName ?? account);
      setNotice(t("SteamCMD 登入已驗證。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const install = async (item: WorkshopItem) => {
    setBusy(item.id);
    setError(null);
    setNotice(null);
    try {
      const installed = await client.installWorkshopItem(instanceId, item.id);
      setNotice(t("已安裝 Workshop Mod:{name}", { name: installed.title }));
      await search();
      onInstalled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <FiSearch className="size-5 text-pal" />
        <h3 className="text-sm font-extrabold">{t("Steam Workshop 商店")}</h3>
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-bold text-ink-muted">App 1623730</span>
      </div>

      {error && <p className={`${errorCls} mt-3`}>{error}</p>}
      {notice && <p className="mt-3 rounded-xl bg-grass/10 px-3 py-2 text-[13px] font-bold text-grass">{notice}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-extrabold"><FiKey /> {t("Steam Web API Key")}</div>
          <div className="flex gap-2">
            <input
              className={`${inputCls} min-w-0 flex-1 font-mono`}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={status?.apiKeyConfigured ? t("已設定,輸入新 Key 可替換") : t("輸入 32 位 Steam Web API Key")}
            />
            <button className={btnGhost} onClick={() => void saveKey()} disabled={!apiKey.trim() || busy !== null}>
              {busy === "key" ? t("儲存中…") : t("儲存")}
            </button>
          </div>
          <p className="text-xs text-ink-muted">{t("Key 僅儲存在 agent,不會回傳到瀏覽器。搜尋 Workshop 時需要此 Key。")}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-extrabold"><FiLogIn /> {t("SteamCMD 登入")}</div>
          {status?.supported ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className={`${inputCls} min-w-0 flex-1`}
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder={t("Steam 帳號名稱")}
                  autoComplete="username"
                />
                <button className={btnGhost} onClick={() => void startLogin()} disabled={!account.trim() || busy !== null}>
                  {busy === "login" ? t("開啟中…") : t("開啟登入視窗")}
                </button>
                <button className={btnGhost} onClick={() => void verifyLogin()} disabled={!account.trim() || busy !== null}>
                  {busy === "verify" ? t("驗證中…") : t("驗證登入")}
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                {status.loggedIn
                  ? t("已驗證帳號:{account}", { account: status.accountName ?? account })
                  : t("密碼與 Steam Guard 只在本機 SteamCMD 視窗輸入,不會傳給 GUI 或 API。")}
              </p>
            </>
          ) : (
            <p className="rounded-xl bg-sun/10 px-3 py-2 text-xs font-bold text-sun">
              {t("SteamCMD 登入與下載僅支援 Windows agent;你仍可搜尋並查看 Workshop。")}
            </p>
          )}
        </div>
      </div>

      <form
        className="mt-5 flex flex-col gap-2 border-t-2 border-line pt-4 sm:flex-row"
        onSubmit={(event) => { event.preventDefault(); void search(); }}
      >
        <div className="relative min-w-0 flex-1">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            className={`${inputCls} w-full pl-9`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜尋 Palworld Workshop Mod")}
            disabled={!status?.apiKeyConfigured}
          />
        </div>
        <select className={inputCls} value={sort} onChange={(event) => setSort(event.target.value as Sort)} disabled={!status?.apiKeyConfigured}>
          <option value="popular">{t("熱門")}</option>
          <option value="trend">{t("趨勢")}</option>
          <option value="new">{t("最新")}</option>
          <option value="updated">{t("最近更新")}</option>
        </select>
        <button type="submit" className={`${btn} inline-flex items-center justify-center gap-1.5`} disabled={!status?.apiKeyConfigured || busy !== null}>
          <FiSearch /> {busy === "search" ? t("搜尋中…") : t("搜尋")}
        </button>
      </form>

      {!status?.apiKeyConfigured && (
        <p className="mt-3 text-center text-[13px] font-bold text-ink-muted">{t("設定 Steam Web API Key 後即可搜尋商店。")}</p>
      )}

      {results && (
        <div className="mt-4">
          <p className="mb-3 text-xs font-bold text-ink-muted">{t("找到 {count} 個項目", { count: results.total })}</p>
          {results.items.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-line py-8 text-center text-sm text-ink-muted">{t("沒有找到符合條件的 Workshop Mod。")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {results.items.map((item) => (
                <article key={item.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border-2 border-line bg-card-soft">
                  {item.previewUrl && <img className="aspect-video w-full object-cover" src={item.previewUrl} alt="" loading="lazy" />}
                  <div className="flex flex-1 flex-col p-3">
                    <div className="flex items-start gap-2">
                      <h4 className="min-w-0 flex-1 break-words text-sm font-extrabold">{item.title}</h4>
                      <a href={item.steamUrl} target="_blank" rel="noreferrer" className="shrink-0 text-pal" title={t("在 Steam Workshop 開啟")}>
                        <FiExternalLink className="size-4" />
                      </a>
                    </div>
                    {item.summary && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-muted">{item.summary}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-muted">{tag}</span>)}
                    </div>
                    <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-ink-muted">
                      <span className="inline-flex items-center gap-1"><FiUsers /> {formatCount(item.subscriptions)}</span>
                      {item.timeUpdated && <span>{t("更新於 {date}", { date: formatDate(item.timeUpdated) })}</span>}
                    </div>
                    <button
                      className={`${item.installed && !item.updateAvailable ? btnGhost : btn} mt-3 inline-flex w-full items-center justify-center gap-1.5`}
                      onClick={() => void install(item)}
                      disabled={busy !== null || running || backend !== "native" || !status?.supported || !status.loggedIn || (item.installed && !item.updateAvailable)}
                      title={running ? t("請先停止伺服器") : backend !== "native" || !status?.supported ? t("僅支援 Windows 原生實例") : !status.loggedIn ? t("請先驗證 SteamCMD 登入") : undefined}
                    >
                      {busy === item.id ? <FiRefreshCw className="animate-spin" /> : item.installed && !item.updateAvailable ? <FiCheckCircle /> : <FiDownloadCloud />}
                      {busy === item.id ? t("下載安裝中…") : item.updateAvailable ? t("更新") : item.installed ? t("已安裝") : t("安裝")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {results.nextCursor && (
            <div className="mt-4 text-center">
              <button className={btnGhost} onClick={() => void search(results.nextCursor)} disabled={busy !== null}>
                {busy === "more" ? t("載入中…") : t("載入更多")}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
