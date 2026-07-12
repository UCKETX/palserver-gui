# palserver GUI — v2.0.0-alpha.5

修正版:讓**同一台主機開多台伺服器**不再因為 Steam 查詢埠衝突而開不起來。

## 🐛 這版修正了什麼

- **同機多開第二台就崩** —— 每台 Palworld 伺服器的 Steam 查詢埠都預設 27015,而這個埠**不寫在 PalWorldSettings.ini 裡**,所以即使你把遊戲埠、REST、RCON 都設成不同值,第二台還是會卡在:

  ```
  CreateBoundSocket: ::bind couldn't find an open port between 27015 and 27015
  ```

  現在每台實例會**自動分配唯一的查詢埠**(從 27015 往上找沒被占用的),並透過兩個管道套用(命令列 `-queryport` + Engine.ini 的 `GameServerQueryPort`,雙保險)。**既有的實例**在更新後也會自動補上、下次啟動即生效,不用手動改設定。

> 只影響原生(native)在同一台主機開多台的情境;單台或分散在不同主機不受影響。

完整 commit 紀錄:[`v2.0.0-alpha.4...v2.0.0-alpha.5`](https://github.com/io-software-ai/palserver-gui/compare/v2.0.0-alpha.4...v2.0.0-alpha.5)

---

## 下載哪一個?

大部分人只要看你電腦對應的那一列就好。解壓縮後**雙擊 `palserver-agent`**,
瀏覽器會自動打開管理介面,不用先裝 Node、不用 Docker、不用打指令。

| 你的電腦 | 下載這個 | 說明 |
| --- | --- | --- |
| **Windows** | **`palserver-agent-windows.zip`** | 最多人用,雙擊即可 |
| **Linux** | `palserver-agent-linux.zip` | 同上 |
| **macOS** | `palserver-agent-macos.zip` | Mac 不能實際開帕魯伺服器(限制),只能拿來管理別台遠端主機 |

> 這三個都是「合一版」:免安裝執行檔 **+** 網頁介面,一個檔案搞定,適合自己開服。

<details>
<summary>其他檔案是什麼?(進階,新手可以直接略過)</summary>

- **`palserver-web.zip`** — 只有「網頁介面」、不含 agent。要把管理網頁自己架到公開網站(例如 Zeabur)給大家線上用時才需要。
- **`*.tar.gz`** — 內容和對應的 `.zip` 一樣,但這是給 agent「一鍵自我更新」讀的格式。**手動下載請用 `.zip`。**
- **`SHA256SUMS.txt`** — 檔案校驗碼,自我更新時會自動比對防止下載損毀,一般玩家可以忽略。
</details>

---

首次安裝會下載較大的帕魯伺服器檔案、需要一點時間,屬正常現象。
安裝與連線教學見 [玩家版指南](https://github.com/io-software-ai/palserver-gui/blob/main/docs/INSTALL.zh-TW.md);有問題歡迎到 [Discord](https://discord.gg/sgMMdUZd3V) 找我們。

> 免費開源,僅限非商業使用(PolyForm Noncommercial)。
