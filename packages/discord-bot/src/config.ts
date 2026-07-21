/** 環境變數讀取與驗證。缺必填直接丟明確錯誤,啟動時 fail fast。 */

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`缺少環境變數 ${name}(必填)。請參考 .env.example 設定。`);
  return v;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const config = {
  /** 唯一必填:Discord bot token。application id / guild id 都自動推導(見 index.ts 自動註冊指令)。 */
  discordToken: required("DISCORD_TOKEN"),
  /** agent 的 base URL,不含結尾斜線。預設本機 —— bot 與 agent 同機時完全不用設。 */
  agentUrl: stripTrailingSlash(process.env.AGENT_URL?.trim() || "http://127.0.0.1:8250"),
  /** 選填:只有「跨機」才需要。bot 與 agent 同機(連 127.0.0.1)時,agent 對 loopback 免 token。 */
  agentToken: process.env.AGENT_TOKEN?.trim() || "",
  /** 選填:固定操作的實例 id。留空則自動取 agent 的第一個實例(單台伺服器就不用設)。 */
  agentInstanceId: process.env.AGENT_INSTANCE_ID?.trim() || undefined,
} as const;
