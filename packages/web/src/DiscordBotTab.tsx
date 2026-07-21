import { useEffect, useMemo, useState } from "react";
import { FiCheck, FiCopy, FiExternalLink } from "react-icons/fi";
import { hasFeature } from "@palserver/shared";
import type { AgentClient } from "./api";
import { CopyPath } from "./CopyPath";
import { copyText } from "./clipboard";
import { t, useI18n } from "./i18n";
import { SponsorLockNotice, card, labelCls } from "./ui";

/**
 * 「Discord Bot」分頁:官方 Discord bot 是獨立自架服務(packages/discord-bot),GUI 這頁是
 * 設定引導 + 憑證助手 —— 顯示 bot 要填的 agent 連線資訊(URL / 存取權杖 / 實例)、.env 範本、
 * 部署步驟與指令表。通知方向走 Webhook 分頁(format:discord),這頁只管「從 Discord 下指令」。
 */

function CopyBlock({ text }: { text: string }) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-line bg-sky-soft p-3 pr-10 text-xs leading-relaxed text-ink">
        {text}
      </pre>
      <button
        type="button"
        onClick={copy}
        title={t("點擊複製")}
        className="absolute right-2 top-2 text-ink-muted transition hover:text-pal"
      >
        {copied ? <FiCheck className="size-4 text-grass" /> : <FiCopy className="size-4" />}
      </button>
    </div>
  );
}

function CredentialRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <label className={labelCls}>
      <span>{label}</span>
      <CopyPath value={value} secret={secret} className="rounded-lg border border-line bg-sky-soft px-3 py-2 text-sm" />
    </label>
  );
}

const COMMANDS: { name: string; desc: string; admin: boolean }[] = [
  { name: "/players", desc: "查看在線玩家", admin: false },
  { name: "/status", desc: "查看伺服器狀態", admin: false },
  { name: "/broadcast", desc: "遊戲內廣播訊息", admin: true },
  { name: "/save", desc: "立即存檔", admin: true },
  { name: "/restart", desc: "重啟伺服器", admin: true },
  { name: "/kick", desc: "踢出在線玩家", admin: true },
  { name: "/ban", desc: "封鎖玩家", admin: true },
  { name: "/rcon", desc: "執行 RCON 指令", admin: true },
];

export function DiscordBotTab({ client, instanceId }: { client: AgentClient; instanceId: string }) {
  useI18n();
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [addresses, setAddresses] = useState<{ ip: string; vpn: string | null }[]>([]);

  useEffect(() => {
    client
      .license()
      .then((l) => setEntitled(hasFeature("webhooks", l)))
      .catch(() => setEntitled(false));
  }, [client]);

  useEffect(() => {
    if (!entitled) return;
    client
      .agentAddresses()
      .then((r) => setAddresses(r.addresses))
      .catch(() => {});
  }, [client, entitled]);

  // 建議的 AGENT_URL:bot 通常在另一台機器,優先給 VPN / Tailscale 位址(對外可連),
  // 否則第一個區網位址;沿用目前連線的 scheme 與 port。
  const agentUrl = useMemo(() => {
    let scheme = "http:";
    let port = "8250";
    try {
      const u = new URL(client.baseUrl);
      scheme = u.protocol;
      port = u.port || (scheme === "https:" ? "443" : "80");
    } catch {
      /* baseUrl 解析失敗就用預設 */
    }
    const pick = addresses.find((a) => a.vpn) ?? addresses[0];
    return pick ? `${scheme}//${pick.ip}:${port}` : client.baseUrl;
  }, [client, addresses]);

  const envTemplate = useMemo(
    () =>
      [
        "DISCORD_TOKEN=（你的 bot token）",
        "DISCORD_CLIENT_ID=（你的 Application ID）",
        "DISCORD_GUILD_ID=（你的 Discord 伺服器 ID）",
        `AGENT_URL=${agentUrl}`,
        "AGENT_TOKEN=（貼上下方的存取權杖）",
        `AGENT_INSTANCE_ID=${instanceId}`,
      ].join("\n"),
    [agentUrl, instanceId],
  );

  if (entitled === false) {
    return (
      <div className="flex flex-col gap-4">
        <SponsorLockNotice>
          {t("這是贊助者先行版功能。到「設定 → 贊助者識別碼」輸入識別碼即可使用。")}
        </SponsorLockNotice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h3 className="text-base font-extrabold">{t("官方 Discord 機器人")}</h3>
        <p className="mt-1 text-sm text-ink-muted">
          {t("在 Discord 用 /players、/restart、/broadcast 等指令直接操作伺服器。這是一個獨立的自架服務,只對外連線、不需要對外開放連接埠(可走 Tailscale)。")}
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          {t("事件通知(玩家上線、死亡等)請到「Webhook」分頁設定;這頁只負責「從 Discord 下指令」。")}
        </p>
      </section>

      <section className={card}>
        <h4 className="text-sm font-extrabold">{t("設定步驟")}</h4>
        <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
          <li>
            {t("到 Discord 開發者後台建立應用程式與 Bot,取得 Bot Token 與 Application ID。")}{" "}
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-pal hover:underline"
            >
              {t("開發者後台")}
              <FiExternalLink className="size-3" />
            </a>
          </li>
          <li>{t("把 Bot 邀請進你的 Discord 伺服器,並取得該伺服器的 ID(Guild ID)。")}</li>
          <li>{t("把下方的 agent 連線資訊填進 bot 的 .env(範本如下)。")}</li>
          <li>{t("執行 pnpm deploy-commands 註冊 slash 指令(只需在指令變動時跑一次)。")}</li>
          <li>{t("用 docker compose up -d 或 pnpm start 啟動 bot。詳見 packages/discord-bot/README。")}</li>
        </ol>
      </section>

      <section className={card}>
        <h4 className="text-sm font-extrabold">{t("這台 agent 的連線資訊")}</h4>
        <p className="mt-1 text-xs text-ink-muted">
          {t("填進 bot 的 .env。存取權杖等同 agent 的完整控制權,請妥善保管、不要外流。")}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <CredentialRow label={t("Agent 連線網址")} value={agentUrl} />
          <CredentialRow label={t("存取權杖(AGENT_TOKEN)")} value={client.token} secret />
          <CredentialRow label={t("實例 ID(AGENT_INSTANCE_ID)")} value={instanceId} />
        </div>
      </section>

      <section className={card}>
        <h4 className="text-sm font-extrabold">{t(".env 範本")}</h4>
        <p className="mt-1 text-xs text-ink-muted">{t("複製後填入 Discord 的三個值,AGENT_TOKEN 貼上上方的權杖。")}</p>
        <div className="mt-2">
          <CopyBlock text={envTemplate} />
        </div>
      </section>

      <section className={card}>
        <h4 className="text-sm font-extrabold">{t("可用指令")}</h4>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {COMMANDS.map((c) => (
            <li key={c.name} className="flex items-baseline gap-2 text-sm">
              <code className="rounded bg-sky-soft px-1.5 py-0.5 font-mono text-xs text-pal-strong">{c.name}</code>
              <span className="text-ink-muted">{t(c.desc)}</span>
              {c.admin && (
                <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{t("管理員")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
