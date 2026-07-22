import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type APIEmbed,
  type ChatInputCommandInteraction,
  type Client as DiscordClient,
} from "discord.js";
import type { BotLang } from "@palserver/shared";
import { AgentError, configureAgent, resolveInstance } from "./agent.js";
import { buildCommands } from "./commands.js";
import { setLang, t } from "./i18n.js";
import { startStatusPanel } from "./status-panel.js";
import { BRAND, brandEmbed } from "./theme.js";

export interface StartBotOptions {
  /** Discord bot token(唯一必填)。application id / guild id 都從 token 推導。 */
  discordToken: string;
  /** 要回控的 agent base URL(不含結尾斜線)。同機 = http(s)://127.0.0.1:<port>。 */
  agentUrl: string;
  /** 跨機才需要;同機連 loopback 免 token。 */
  agentToken?: string;
  /** 固定操作的實例 id;留空取第一個實例。 */
  instanceId?: string;
  /** 管理員白名單(whitelist-only):只有這些 Discord user id 能用管理指令。留空 = 沒人能用。 */
  adminUserIds?: string[];
  /** 狀態面板頻道 id(留空 = 不顯示):bot 在該頻道維護一則每分鐘自動更新的伺服器狀態 embed。 */
  statusChannelId?: string;
  /** bot 輸出語言(指令描述/embed 文字);留空預設 en。 */
  language?: BotLang;
}

export interface RunningBot {
  /** 關閉 Discord 連線(登出 gateway)。 */
  stop(): Promise<void>;
}

/** Discord API 10062 = Unknown interaction(互動已逾時/失效);對這種互動無法再回覆,視為良性。 */
function isExpiredInteraction(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 10062;
}

/**
 * 啟動 Discord bot:建立 gateway client、自動註冊 slash 指令、把互動轉成對 agent 的 REST 呼叫。
 * standalone(index.ts)與 agent 同機內嵌(PALSERVER_RUN_BOT)共用這一支;差別只在參數怎麼來。
 * 呼叫端負責讓行程專屬於 bot —— 登入失敗會直接 process.exit(1),讓監督者(agent / shell)察覺並重試。
 */
export function startBot(opts: StartBotOptions): RunningBot {
  configureAgent({ agentUrl: opts.agentUrl, agentToken: opts.agentToken ?? "", instanceId: opts.instanceId });
  // 一定要在 buildCommands() 之前設語言:指令描述在建構陣列的當下就用 t() 決定文字,
  // 之後才呼叫 setLang 就太晚了(見 commands.ts 頂部註解)。
  setLang(opts.language ?? "en");

  // 監督式長駐 bot:單一次互動 / 通知的未預期錯誤不該讓整個行程崩潰 —— 否則行程一死,當下與
  // 後續所有 slash 指令都會顯示「該申請未受回應」(Discord 3 秒內收不到 ack),直到監督者重啟。
  // 記進 log(GUI 看得到)後繼續跑;真正致命的登入失敗仍由下方 login().catch 明確退出。
  process.on("unhandledRejection", (reason) => {
    console.error("[discord-bot] 未處理的 rejection:", reason instanceof Error ? (reason.stack ?? reason.message) : reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[discord-bot] 未捕捉的例外:", err instanceof Error ? (err.stack ?? err.message) : err);
  });

  // slash 指令走 Interactions,不需要讀訊息內容,所以只要 Guilds intent。
  // rest 放寬:defer 之後 Discord 給 15 分鐘完成處理並回覆,長操作(update/backup/restart)沒問題;
  // 對連線較慢的主機,把每次 REST 請求的逾時與重試次數調高,讓回覆階段更耐得住暫時的網路延遲。
  // (注意:初始 ack 的 3 秒是 Discord 伺服器端硬性限制,無法從這裡延長。)
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { timeout: 30_000, retries: 5 },
  });
  const commands = buildCommands();
  const commandMap = new Map(commands.map((c) => [c.json.name, c]));
  const commandBody = commands.map((c) => c.json);
  // 管理員白名單(whitelist-only):只認這些 Discord user id,不看 Discord 伺服器管理員權限。留空 = 沒人能用管理指令。
  const adminIds = new Set(opts.adminUserIds ?? []);

  /** 事件通知(同機模式):agent 主行程經 IPC 傳來渲染好的 embed,貼到指定頻道。
   *  standalone(無 IPC 父行程)時 process.on("message") 不會觸發,無害。 */
  async function postNotify(channelId: string, embeds: unknown[]): Promise<void> {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch?.isSendable()) await ch.send({ embeds: embeds as APIEmbed[] });
      else console.error(`[discord-bot] 通知頻道 ${channelId} 不存在或無法發送(缺權限?)`);
    } catch (err) {
      console.error("[discord-bot] 發送事件通知失敗:", err instanceof Error ? err.message : err);
    }
  }
  process.on("message", (msg: unknown) => {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { kind?: string; channelId?: string; payload?: { embeds?: unknown[] } };
    if (m.kind !== "notify" || !m.channelId || !m.payload) return;
    void postNotify(m.channelId, m.payload.embeds ?? []);
  });

  /** 啟動時把指令自動註冊到 bot 目前所在的每個 Discord 伺服器 —— 使用者不必手動跑 deploy,
   *  也不必填 application id / guild id(都從 token 推導)。指令定義變動後重啟即重新註冊。 */
  async function registerGuildCommands(readyClient: Client<true>): Promise<void> {
    const guilds = [...readyClient.guilds.cache.values()];
    for (const guild of guilds) {
      try {
        await readyClient.application.commands.set(commandBody, guild.id);
      } catch (err) {
        console.error(`[discord-bot] 註冊指令到「${guild.name}」失敗:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[discord-bot] 已在 ${guilds.length} 個伺服器自動註冊 ${commandBody.length} 個指令`);
  }

  async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    if (command.admin && !adminIds.has(interaction.user.id)) {
      await interaction.reply({
        embeds: [
          brandEmbed({
            color: BRAND.danger,
            title: t("權限不足"),
            description: t(
              "此指令僅限管理員(白名單)使用。請伺服器主在 GUI 的「Discord Bot」分頁把你的 Discord user id 加入白名單。",
            ),
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ack 必須在 Discord 建立互動後 3 秒內送達,否則互動失效(10062)。這裡 defer 是收到互動後的
    // 第一件事;若仍逾時,代表 gateway 遞送 + REST 往返 > 3 秒(與 Discord 的連線延遲),對這次
    // 互動無能為力 —— 記一句話略過,不噴堆疊。
    try {
      await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
    } catch (err) {
      if (isExpiredInteraction(err)) {
        console.warn(`[discord-bot] /${interaction.commandName} 互動已逾時(3 秒內未能回應 Discord,通常是連線延遲)`);
        return;
      }
      throw err;
    }

    try {
      const instance = await resolveInstance();
      const embed = await command.run(interaction, instance);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (isExpiredInteraction(err)) return; // 互動中途失效,無從回覆
      const message = err instanceof AgentError || err instanceof Error ? err.message : String(err);
      console.error(`[discord-bot] /${interaction.commandName} 執行失敗:`, message);
      // editReply 本身也可能因互動失效而拋錯 —— 包起來,別讓它逃逸。
      try {
        await interaction.editReply({
          embeds: [brandEmbed({ color: BRAND.danger, title: t("操作失敗"), description: message })],
        });
      } catch {
        /* 互動已失效,無法回覆 */
      }
    }
  }

  let statusPanel: { stop(): void } | null = null;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord-bot] 已上線:${readyClient.user.tag}`);
    await registerGuildCommands(readyClient);
    // 狀態面板:指定頻道維護一則每分鐘自動更新的伺服器狀態 embed(見 status-panel.ts)。
    if (opts.statusChannelId) statusPanel = startStatusPanel(readyClient, opts.statusChannelId);
    try {
      const instance = await resolveInstance();
      readyClient.user.setActivity(instance.name, { type: ActivityType.Watching });
    } catch (err) {
      console.error(
        "[discord-bot] 設定上線狀態失敗(不影響指令運作):",
        err instanceof Error ? err.message : err,
      );
    }
  });

  // bot 被加進新的 Discord 伺服器 → 自動註冊指令(不用手動處理)。
  client.on(Events.GuildCreate, async (guild) => {
    try {
      await guild.client.application?.commands.set(commandBody, guild.id);
      console.log(`[discord-bot] 已在新加入的「${guild.name}」註冊指令`);
    } catch (err) {
      console.error(`[discord-bot] 註冊指令到「${guild.name}」失敗:`, err instanceof Error ? err.message : err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    // 外層再包一次:handleCommand 內的 deferReply/reply 若拋錯(如互動已逾時)會逃逸成
    // unhandledRejection —— 這裡吞掉並記錄,確保一次壞互動不會拖垮整個行程。
    try {
      await handleCommand(interaction);
    } catch (err) {
      if (isExpiredInteraction(err)) {
        console.warn(`[discord-bot] /${interaction.commandName} 互動已逾時(3 秒內未能回應 Discord,通常是連線延遲)`);
      } else {
        console.error(
          `[discord-bot] /${interaction.commandName} 互動處理未預期錯誤:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        );
      }
    }
  });

  // 登入失敗(token 無效等)= 這個 bot 行程沒有存在意義 —— 印出原因並以非零碼退出,
  // 讓監督者(agent 的 DiscordBotManager,或 shell)看得到崩潰並按退避重試。
  void (client as DiscordClient).login(opts.discordToken).catch((err) => {
    console.error("[discord-bot] 登入失敗:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

  return {
    stop: async () => {
      statusPanel?.stop();
      await client.destroy();
    },
  };
}
