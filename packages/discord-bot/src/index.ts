import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { AgentError, resolveInstance } from "./agent.js";
import { commands } from "./commands.js";
import { config } from "./config.js";
import { BRAND, brandEmbed } from "./theme.js";

// slash 指令走 Interactions,不需要讀訊息內容,所以只要 Guilds intent。
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commandMap = new Map(commands.map((c) => [c.json.name, c]));
const commandBody = commands.map((c) => c.json);

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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[discord-bot] 已上線:${readyClient.user.tag}`);
  await registerGuildCommands(readyClient);
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
  await handleCommand(interaction);
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  if (command.admin) {
    const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    if (!hasPermission) {
      await interaction.reply({
        embeds: [
          brandEmbed({ color: BRAND.danger, title: "權限不足", description: "此指令僅限管理員使用。" }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);

  try {
    const instance = await resolveInstance();
    const embed = await command.run(interaction, instance);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof AgentError || err instanceof Error ? err.message : String(err);
    console.error(`[discord-bot] /${interaction.commandName} 執行失敗:`, message);
    await interaction.editReply({
      embeds: [brandEmbed({ color: BRAND.danger, title: "操作失敗", description: message })],
    });
  }
}

client.login(config.discordToken);
