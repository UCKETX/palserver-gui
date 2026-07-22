# 線上地圖強化計畫（2026-07-18 盤點）

> 來源：本日對地圖功能的全面盤點（程式碼探索 + paldb.cc 主世界 map_data 實抓分析）。
> 優先序結論：**P0 公開地圖（急件，見第五節）**，之後 **A2 圖層面板 → B5 右鍵指令 → A3 玩家進度覆蓋**，其餘列 backlog。
> root `todo` 檔第 8–18 條是本檔的一句話索引。

---

## 一、現況架構（改地圖前先看這段）

### 前端
- 主元件 `packages/web/src/MapTab.tsx`（~1190 行，整支就是地圖本體）
  - Leaflet `CRS.Simple`，兩張底圖：主世界 `palworld-full-map.jpg`（palworld.gg tiles）＋世界樹 `worldtree-map.webp`（paldb.cc tiles），各自 `IMAGE_BOUNDS` / `TREE_IMAGE_BOUNDS`（MapTab.tsx:36-52）
  - `PlayerMap` 元件（:816-1191）：底圖切換＋各 marker 渲染 effect
  - 已有圖層：在線玩家（:1148，頭像＋公會色框＋ping 角標）、離線玩家（:1112）、公會據點（:1081）、地標 Fast Travel/Tower/Dungeon（:1022，樣式 `LANDMARK_STYLE` :87-91）、Alpha 頭目（:1046）、礦點 ~3.9k 點（:944，**用 `L.canvas` circleMarker**，密集層都要走這條路）、偷襲警示 `RAID_RADIUS`（:75, :1013）
- 選座標元件 `packages/web/src/MapPickModal.tsx`（給 RCON tp/spawn 用；Leaflet 點擊回傳的就是地圖座標，**不需**轉回世界座標）
- 聯動：`InstanceDetail.tsx:566-583` 的 `mapFocus`；`PlayerDetailModal` / `GuildDetailModal` / `GuildsTab` / `PlayersTab` 都有 `onShowOnMap`
- 全螢幕路由 `/map`（App.tsx:44,91）；divIcon 樣式在 `styles.css:435,486,511`
- i18n 是單檔 `packages/web/src/i18n.tsx`（中英日）

### 後端資料管線（三條）
1. **遊戲官方 REST**：`GET /api/instances/:id/live`（routes.ts:1320）→ `restapi.ts:95` `getLiveStatus`，在線玩家即時座標
2. **PalDefender REST**（`paldefender-rest.ts`，proxy 全在這支）：
   - `/players` 含離線最後座標（routes.ts:1330 → paldefender-rest.ts:386）
   - `/guilds` 公會＋據點座標（routes.ts:1335；名稱/成員鎖 `featureEnabled("guild-map")`）
   - `/guild/{id}` 詳情（routes.ts:1341，贊助限定）
   - `getPlayerDetail`（paldefender-rest.ts:610）：/player /pals /items /techs /progression，目前只有玩家詳情頁在用
   - `givePalEgg`（paldefender-rest.ts:584）
   - RCON `tp`：`POST /api/instances/:id/teleport`（routes.ts:1604，贊助）
3. **palsav 存檔解析**（save-tools.ts 編排、save-health.ts 串流解析）：
   - 公會/據點（含座標、駐守帕魯容器、研究進度：save-health.ts:384-410, 620-660）
   - 圖鑑 `extractPaldeck`（save-tools.ts:480）
   - 快速傳送解鎖旗標 `RecordData.FastTravelPointUnlockFlag`（save-unlocks.ts:30-90；GUID 表 fast-travel-points.ts，174 點）
   - `getGuildsSnapshot` 路由 routes.ts:2128
   - **尚未解析**：帕魯個體（CharacterSaveParameterMap）

### 靜態資料
- `packages/web/public/game-data/`：`landmarks.json` / `bosses.json` / `ores.json`（主世界，來自 paldb.cc `map_data_en.js` 的 `fixedDungeon`）＋ `worldtree-{landmarks,bosses,ores}.json`（腳本 `scripts/fetch-worldtree-mapdata.mjs`）＋ pals/items/… 目錄
- 引用來源慣例寫在 `packages/web/public/game-data/CREDITS.md`——新抓資料要照補
- 座標轉換：`packages/shared/src/index.ts:509-545`（`savToMap`、`savToWorldTreeMap`、`isWorldTreeCoord`）；前端分流在 MapTab.tsx:977-982

---

## 二、paldb.cc 主世界 map_data 實抓盤點（2026-07-18，13,375 筆）

抓 `https://paldb.cc/js/map_data_en.js`（1.78MB），`fixedDungeon` 共 13,375 筆、65 種 type。
**關鍵：主世界全部條目只有 `ipos`（遊戲內地圖座標），沒有 `pos`**——與現有 landmarks/ores 管線同一座標系，可直接畫，不用轉換（世界樹相反，用 pos+savToWorldTreeMap）。ipos 範圍含 -1306、-1229 等超出 ±1000 的值（櫻島/天墜之地等新島），現有底圖 bounds 已涵蓋（landmarks/ores 同源已在畫）。

尚未畫的類型（筆數）——目前只用了 Fast Travel / Tower / Dungeon / Alpha Pal / 礦物：

| 分組 | type（筆數） |
|---|---|
| 蛋 | Feybreak Egg(567)、Grass(441)、Volcano(310)、Frozen(271)、Desert(122)、Sakura(36)；欄位有 itemId、cooldown |
| 雕像/收集 | Lifmunk Effigy(140)、其他 10 種帕魯雕像(各 30 或 4)、Yakumo(2)、Journals(55)、Beautiful Flower(27)、Kinship Peach(22) |
| 寶箱/打撈 | Treasure(1350)、Salvage Rank2(1987)、Salvage Rank1(776)、Treasure Element(109)、Treasure Map(42)、Oilrig Treasure(47)+Goal(9)、Supply(480) |
| 採集 | Fishing Spot(529)、Junk(646)、Fruit Tree(31)、Nightstar Sand(271, 有 onlyTime 欄位=夜間限定)、Heat Source(20) |
| 礦物補充 | Cluster 系列(Ore 31/Coal 33/Quartz 11/Sulfur 8)、Ancient Lava/Bark/Bone(各 10)——確認 ores.json 是否已含 |
| NPC/商人 | NPC(164, 含 id/lv)、Wandering Merchant(8)、Black Marketeer(7)、City(73, 帕魯頭像 fixed_icon)、Unknown(22, 隱藏 boss 類) |
| 設施 | Ancient Ruin(106)、Incident(88)、Skyland Warp Altar(20)、Watchtower(20)、Respawn(8)、Enemy Camp(44)、Anti-Air Turret(11) |

盤點腳本存於 session scratchpad `inventory-mapdata.mjs`（重跑即可再現；核心邏輯：抓 js、括號配對取 `fixedDungeon = [...]`、eval、按 type 統計）。

世界樹版（treemap_data，433 筆 19 類）已完整盤點在 `.claude/notes/worldtree-mapdata-inventory.md`，四語對齊、翻譯欄位、ipos 陷阱都寫在那。

---

## 三、優先三項的實作草案

### A2. 圖層開關面板＋補齊靜態圖層＋搜尋跳轉
1. 新腳本 `scripts/fetch-map-mapdata.mjs`（仿 fetch-worldtree-mapdata.mjs）：從 map_data_{en,tw,cn,ja} 產出新圖層 JSON。建議分組打包而非 65 檔：`eggs.json`、`collectibles.json`（雕像/日誌/花/桃）、`treasures.json`、`gathering.json`（釣魚/垃圾/果樹/夜砂）、`npcs.json`（商人/NPC/City）。翻譯處理照世界樹腳本的四語 zip 模式。
2. MapTab 加圖層面板：分組 toggle（預設只開現況圖層，新圖層預設關）＋狀態存 localStorage。密集層（Treasure 1350、Salvage 2763、蛋 1747…）一律走礦點的 `L.canvas` 路徑；稀疏層（商人、雕像、祭壇）可用 divIcon。
3. 搜尋框：地標名/玩家名 → `flyTo`。資料就是已載入的各圖層陣列＋players。
4. i18n（i18n.tsx 中英日）＋ CREDITS.md 補來源。
- 驗證：dev 起服 → 每組圖層開關一次截圖；`pnpm --filter web build`。

### B5. 地圖右鍵指令選單（把地圖變操作台）
- 右鍵玩家 marker：傳送到他（tp self→player）／把他傳來／給蛋（givePalEgg）／開玩家詳情。右鍵任意點：傳送某玩家到此（teleport API 已收座標）／在此生成（接 ConsoleTab 既有 RCON spawn 流程）／複製座標。
- 後端全部現成（routes.ts:1604 teleport、paldefender-rest.ts:584 givePalEgg、rcon.ts）；純前端接線＋權限 gating（贊助功能照 featureEnabled 現況顯示鎖圖示）。
- Leaflet 右鍵＝`contextmenu` 事件；手機長按注意（Leaflet 會轉 contextmenu，實測一下）。

### A3. 玩家進度覆蓋圖（差異化最大）
- 後端：新端點 `GET /saves/player-progress/:uid`（或併入 getPlayerProfile）回：已解鎖傳送點 GUID 集合（讀 FastTravelPointUnlockFlag——**save-unlocks.ts 目前是寫入用，讀取邏輯要從中拆出**）＋圖鑑已捕捉物種（extractPaldeck 現成）。
- 前端：地圖加「進度視角」選單選玩家 → 未解鎖傳送點灰化/紅點、Alpha marker 標「圖鑑未收錄」徽章。
- 誠實邊界:「Alpha 未討伐」存檔沒有直接旗標，用「該物種未入圖鑑」近似，UI 文案要寫清楚。
- 傳送點 GUID ↔ 地圖 landmark 的對應要驗證：fast-travel-points.ts 的 174 GUID vs landmarks.json 的 Fast Travel 條目（137 主世界＋15 世界樹＋…），名稱比對可能有落差，先寫比對腳本確認覆蓋率。

---

## 四、Backlog（依投入排序，一句話版在 root todo 8–18）

- **玩家軌跡/熱力圖**：agent 輪詢 live 座標落地存時間序列（SQLite/JSONL per instance）→ 軌跡回放、熱力圖。適合贊助層。
- **事件疊加**：players-feed 已解析死亡/聊天 log → 死亡墓碑 marker（幫找屍體）、聊天氣泡、上下線動畫。
- **地理圍欄告警**：管理員畫區域，進入觸發 tray/Discord webhook。agent 端規則引擎，RAID_RADIUS 是雛形。
- **世界樹敵營層**：Enemy Camp+防空炮塔 55 筆的 ipos 轉換未解（Y 有負值），拿兩個可辨識點反算線性式即可。
- **全服帕魯普查**：解 CharacterSaveParameterMap → 稀有/Lucky/滿詞條帕魯分佈圖，據點聚合。與 todo #2 作弊偵測、#3 配種計算器共用同一份解析，**先做解析基建再一魚三吃**。
- **時間軸回放**:每次備份解析快照存歷史 → 公會領土消長拉桿回放。
- **玩家自助唯讀地圖**：token 分享連結、可裁敏感圖層。裝機理由級功能，需要想 auth（現有 token 機制延伸）。
- **Discord 定時快照**：headless 渲染地圖推 webhook。可用 website 既有 playwright 截圖管線。
- **傳送選點地圖（MapPickModal）支援世界樹**（2026-07-22 使用者提出，先擱置）：目前 `MapPickModal.tsx`
  只有主世界，選了座標直接把 Leaflet map 座標(-1000~1000)當 `tp x y z` 的參數送給 PalDefender
  （現有主世界邏輯的依據見該檔案註解：「tp 吃的就是地圖座標，不需再換算世界座標」）。
  **卡住的原因**：世界樹是完全獨立的座標區域（世界座標 X∈[347351.5,689148.5] Y∈[-818197,-476400]，
  跟主世界不重疊），`packages/shared/src/index.ts:546` 的 `savToWorldTreeMap` 只有「世界座標→地圖座標」
  的正向轉換（過去只用來顯示東西在地圖上哪裡），**完全沒有反向轉換**，也没有任何既有程式碼把座標寫回
  遊戲時考慮過世界樹。真正卡住的是一個未驗證的技術問題：**PalDefender 的 `tp` 指令對世界樹到底吃哪種
  座標**——跟主世界一樣的「地圖小座標」(-1000~1000，遊戲依「玩家目前所在區域」自動換算)？還是必須給
  世界樹的原始世界座標（大數字)？還是 `tp` 根本不區分、全部當原始世界座標看（那主世界現有實作「不換算
  直接送地圖座標」搞不好本身也只是巧合/簡化,需要一併查清楚)？查過 PalDefender 原始碼/文件、社群討論
  沒有查到定論（一次背景研究因 session 額度中斷,沒查完;之後接手可以重跑,或更快的方法是直接在
  Windows 測試機**實測**：選世界樹裡一個已知參考點，用「地圖小座標」與「換算後的世界座標」兩種方式各
  試一次 `tp`，看玩家實際落在哪裡）。**在驗證這個之前，不要盲目接世界樹的傳送座標**——猜錯會把玩家
  傳送到不知道哪裡去。若查清楚是「需要世界座標」，要先寫一個 `mapToSavWorldTree`（`savToWorldTreeMap`
  的反函式,線性公式反解即可,不難）。

---

## 五、P0 急件：公開地圖（服主一鍵把地圖公開到全網）

需求（使用者 2026-07-18 原話）：提供一個選項，讓服主把地圖資料公開到全網讓其他玩家也能訪問，並加上細項設定控制公開版只顯示哪些資訊。

### 架構決策（2026-07-18 使用者定案：**甲乙都做，甲先出**）
- **甲、雲端快照中繼（第一階段，已開工）**：agent 每 60 秒把「已過濾快照」推到 stats Worker，公開 viewer 掛官網 `palserver-gui.iosoftware.ai/map/?s=<shareId>`。家用 NAT 零設定。
- **乙、agent 本機公開路由（第二階段）**：agent 非 `/api/` 路由本來就不過 auth（index.ts:140-141 的先例）→ 加 `/public-map/<shareId>` 唯讀 JSON＋viewer 靜態頁（viewer 已支援 `?api=` 覆寫，可直接復用）。給有自備域名/反代的進階服主。

### 查證到的基建事實（2026-07-18）
- 雲端：`packages/stats` Cloudflare Worker（D1），掛 stats.iosoftware.ai（備援 palserver-stats.iosoftware.workers.dev，中國線路 workers.dev 被污染所以自訂域名為主）。agent 推送慣例：telemetry.ts:73-102（多端點 fallback、8s timeout、失敗靜默）。**注意：這個 Worker 同時服務贊助授權，部署要小心。**
- agent auth：Bearer token（auth.ts），`/api/*` 全擋、白名單只有 /api/info 與 /api/pair（index.ts:140-148）；非 /api/ 路徑完全不過 auth。CORS 白名單 WEB_ORIGINS（env.ts:38-45）。
- 官網：Next 15 App Router 純靜態匯出（output:'export'），部署 Zeabur（zbpack.json），無 API route → viewer 只能純前端打 Worker。靜態段 `/map` 優先於 `[lang]` 動態段。
- 沒有任何既有分享 token 機制；pair code 是全權 token，不可挪用。
- 贊助 gating：shared/features.ts（`hasFeature`）＋agent 端 license.ts `featureEnabled()`；`guild-map`（公會名）已是贊助功能 → 公開快照的公會名也受同一 gate 壓制。

### 第一階段實作契約（四個並行工作包依此開發，改欄位名要四處同步）
- Worker（packages/stats）：`POST /api/map/publish {id,key,snapshot}`（首見註冊 key hash；131072B 上限；同 id <10s 429）／`GET /api/map/snapshot?id=` 公開（CORS *，max-age=15）／`POST /api/map/unpublish {id,key}`。D1 表 `map_shares(id, key_hash, updated_at, snapshot)`。
- 快照 v1：`{v, name, generatedAt, onlineCount, maxPlayers?, show:{...}, players:[{n,lv,x,y,m}], offline:[...], bases:[{x,y,m,g?}]}`；x/y 是 savToMap 轉換後的 ±1000 地圖座標，`m`＝"world"|"tree"（viewer 因此不需要座標公式）；關掉的圖層整欄省略；過濾一律在 agent 端。
- agent：`PublicMapSettings`（shared 匯出：enabled/shareId/showPlayers/showPlayerNames/showOfflinePlayers/showBases/showGuildNames/delayMinutes 0|5|15）；secret 不進前端；路由 GET/PUT `/api/instances/:id/public-map`＋POST `.../rotate`；60s 發布迴圈＋delayMinutes 環形緩衝；免費功能不 gate（公會名除外）。
- viewer（website/app/map/page.tsx）：`?s=` 讀 shareId、`?api=` 覆寫 API base；底圖常數抄 MapTab.tsx:36-52；資產 build 前置腳本從 packages/web/public 複製；20s 自動刷新；>5min 顯示離線橫幅；noindex。
- GUI 設定（packages/web）：地圖分頁掛「公開地圖」設定彈窗（總開關/細項/分享連結+複製/重生連結+確認/發布狀態）。

### 第一階段完成紀錄（2026-07-18，commit dd8dbd5）
四包（Worker/agent/GUI 設定/官網 viewer）實作完成；fresh-context 驗收官端對端 6/7 通過（唯一 FAIL 是外部並行編輯造成的 git status 差異，與功能無關）；安全審查 5 個 finding 全數修畢：Worker 防灌爆（per-IP 24h 10 個新註冊、總量 5 萬上限、60 天過期清理）＋撤銷墓碑（410）、agent 延遲繞過（空緩衝發最小快照）、撤銷競態（generation 防護＋持久化下架佇列 DATA_DIR/public-map-unpublish-queue.json）、刪實例先下架、viewer undefined 防呆。

### 上線紀錄（2026-07-18 全部完成）
- Worker：map 端點部署到正式帳號（3526ming，version 44fe5732），D1 建表完成，線上冒煙全過（publish/snapshot/401/unpublish/404/410、/api/stats 與 license 回歸正常）。部署要點：本機 wrangler 預設登入舊帳號 gridflex87，**要用 3526ming 憑證**（詳見專案 memory stats-worker-deployed）。
- 官網 viewer：Zeabur 自動部署 `/map/` 頁；實測 Zeabur 拿不到 `../packages` → map-assets 已改為直接進 git（commit 0c920c5），資產上線確認 200。
- 端對端實證：正式 Worker 發布示範快照 → `palserver-gui.iosoftware.ai/map/?s=…` Playwright 截圖確認底圖/玩家標籤/圖層開關全渲染，驗畢已撤銷示範快照。
- GUI 端（agent 發布器）隨下次 release 對使用者生效，屆時建議實測一輪「GUI 開公開地圖 → 手機開連結」。

### 待辦
- 順帶發現：`palserver-stats.iosoftware.workers.dev`（備援轉發）回 CF 制式 error 1042，備援鏈路疑似斷的；主端點正常。與本功能無關但值得修。
- packages/web 的地圖底圖/地標若更新，記得重跑 `website/scripts/copy-map-assets.mjs` 並 commit（Zeabur 吃不到 ../packages）。
- 官網 viewer 上線：確認 Zeabur 自動部署後 `/map/` 可達、`prebuild` 複製腳本在 Zeabur 環境拿得到 `../packages/web/public`（拿不到的補救：把 map-assets 直接 commit 進 website/public）。
- 公開地圖免費（成長功能），公會名沿用 guild-map gate——已照此實作。

### 細項隱私設定（公開版顯示哪些，設定存 instance config）
- 圖層級開關：靜態地標/礦點（無隱私疑慮，預設開）、公會據點位置、在線玩家位置、離線玩家最後位置（預設關）
- 資訊級開關：玩家名稱（關→顯示匿名代號）、公會名稱、玩家等級/頭像、在線人數統計
- 即時性：即時 / 延遲 N 分鐘（防 PvP 抓位置）/ 只顯示不含玩家的靜態地圖
- 總開關＋分享連結重生（換 token 即撤銷舊連結）

### 實作要件（兩案共通）
- agent 端「公開快照組裝器」：從既有 live/paldefender/guilds 資料組出過濾後 JSON——過濾一定做在 agent 端，不能把全量資料丟給前端再藏（否則看 network 就洩底）
- 公開 viewer：復用 MapTab 的 Leaflet 底圖＋圖層渲染，拆出一個無認證、無管理功能的輕量頁
- 設定 UI：實例設定加「公開地圖」區塊
- 現況查證（auth 機制、stats worker 推送管線、website 結構）已派工，結果落地後補寫到本節

## 六、技術注意事項（實作前必讀）

1. 密集 marker 一律 `L.canvas`（礦點 3.9k 的既有做法，MapTab.tsx:944）；新增全部圖層全開可能再加 ~8k 點，注意 toggle 預設關。
2. 主世界 map_data 用 `ipos` 直畫；世界樹用 `pos`＋`savToWorldTreeMap`。兩者別搞混。
3. paldb.cc 抓的資料照 CREDITS.md 慣例補來源條目。
4. i18n 單檔 `i18n.tsx`；改它 commit 前 `git diff` 確認只有自己的 key（歷史教訓：曾把使用者未 commit 的 WIP key 帶進 commit）。
5. 贊助 gating 沿用 `featureEnabled()`（guild-map 的做法）。
6. UI 禁 emoji，圖示用 react-icons（專案規範）。

---

## 公開地圖 viewer 對齊管理員地圖 + 品牌化（2026-07-18，commit 69f1219 已上線）

第二輪需求「viewer 呈現全面對齊管理員 GUI 地圖、外框跟官網首頁一致」。四包並行 + 對抗式 workflow 審查後上線（Zeabur 已重佈、正式站截圖確認）：
- **marker 全改 GUI 呈現**：玩家圓框帕魯頭像（userId 雜湊選怪物圖，演算法抽成 `@palserver/shared/map-helpers.ts` + `pal-avatars.generated.ts`，MapTab 改 import 做等價重構）、偷襲警告紅圈（`RAID_RADIUS=70`，agent `computeRaidingUserIds` 照抄 MapTab `guildOf`/`enemyBaseNear`）、據點方形公會色圈（色碼 `c` 由 agent `guildColorFromId` 算好帶進快照）、野外頭目層（皇冠+等級）、地標改 `L.icon` 補齊快速旅行/塔/**地牢**全類型。
- **背景**：`website/app/map/map.css` 的 `.map2-card --map2-canvas-bg: #232030` **固定深色、不隨主題**（底圖坐落近黑，淺色會圈白邊；對齊 GUI 深色地圖）。
- **頂欄**：`website/app/map/MapNav.tsx` 直接渲染官網 `Nav.tsx` 同一套 DOM 吃 globals.css；`MapLangSwitch` 換成切 viewer 顯示語言（localStorage `palserver.mapLang`）。**新增 zh-CN 成四語**（繁中/簡中/英/日，對齊官網 locales），`pickLocalizedName` 讓 zh-CN marker 名 fallback 繁中→英。
- **隱私修正（workflow 對抗式審查抓到的 HIGH，本批引入的回歸）**：玩家 `icon` 原本無條件送；icon 是 userId 穩定雜湊 → 匿名（showPlayerNames=off）時附頭像會讓匿名玩家可跨快照/跨伺服器重連、或用已知 Steam id 反查定位。改成**只在 showPlayerNames 開啟時才送 icon**（public-map.ts `mapPlayers`），加回歸測試。icon 欄位本批新增、尚未隨 release 出貨，無曝險窗口。
- **資產**：pal-avatars(300)+bosses.json 等 303 檔直接進 git（Zeabur 吃不到 ../packages）；`copy-map-assets.mjs` 聯集 agent 端凍結頭像清單，避免 pals.json 單邊更新 → viewer 404。

## 礦物移除 + 頭目分類（2026-07-19，commit 22052af）
- **移除礦物層**：管理員 MapTab 與公開 viewer 的礦物圖層全數移除（copy-map-assets 也拿掉 ores.json；game-data 的 ores.json 資料檔保留但不再被讀）。
- **頭目改名 + Alpha/封印領域 分類**：「野外頭目」→「頭目」；bosses.json/worldtree-bosses.json 每筆加 `kind`（`field`=Alpha Pal / `sealed`=封印領域），來源 paldb `Alpha Pal` 的 `comment`（Field/Dungeon），**用座標(ipos = bosses.json 的 x,y)當 join key**（不是 index 也不是 name.en——後者是 fallback 會 0% 命中）。主世界 65 field / 18 sealed（18 筆名單與 palworld.gg 完全吻合），世界樹全 field。兩張地圖 marker 依 kind 區分：field 紅框皇冠、sealed 紫框菱形；tooltip 標「阿爾法/封印領域」。生成腳本 fetch-zh-cn.mjs / fetch-worldtree-mapdata.mjs 已改為輸出 kind（regen 會保留）；一次性 enrich 腳本存 scripts/enrich-boss-kind.mjs。
- i18n 新 key「阿爾法」「封印領域」與「頭目」(en 值 Alpha→Boss) **被平行 session 的 commit d4d72b8 掃進去提交了**（內容正確、無衝突，只是不在我的 commit 裡）。

## ⚠️ 平行 session 正在動 boss-respawn（2026-07-19）
另一個 session 同時在開發「頭目重生時間(boss-respawn / 地下城頭目)」並持續 commit+push（d4d72b8、c34b3ec、b6bcb4d…）。**目前 HEAD 的 `packages/web/src/flags.ts` SHOW_BOSS_RESPAWN=true**（b6bcb4d「暫時開回…供實機研究判活」），與已發布的 v2.5.0（3e2b49a，SHOW_BOSS_RESPAWN=false，隱藏）不同 —— 若下次從 HEAD 再發版，boss-respawn 分頁會**變成對外可見**,發版前要確認這個旗標是否該關回 false。動 shared/index.ts、features.ts、agent/routes.ts、web i18n json、flags.ts 前先 git fetch + diff 分辨 boss-respawn WIP,commit 前 git status 確認沒混到他們的檔。

### 注意：工作區有平行的 boss-respawn/boss-reporter WIP（非本功能）
2026-07-18 起 repo 工作區有另一個「頭目重生時間」功能的未 commit WIP（`boss-respawn.ts`/`boss-reporter.ts`/`BossRespawnTab.tsx`、features.ts 的 boss-respawn 條目、agent routes 的 boss-respawns 路由、i18n boss 字串等）。commit 69f1219 時已 surgical 排除——當時 `packages/shared/src/index.ts` 同時含我的 map export 與 boss-respawn export，用「移除 boss 行 → git add → 還原」隔離。之後動 shared/index.ts、features.ts、agent/routes.ts、web i18n json 前，先 `git diff` 分辨哪些是 boss WIP，勿混提交。
