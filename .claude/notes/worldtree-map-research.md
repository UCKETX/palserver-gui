# World Tree(世界樹)地圖整合研究筆記

日期:2026-07-16。Palworld 1.0(build 1.100.427)於 2026-07-10 上線,本研究在上線後第 6 天進行。

## 結論先行

- **World Tree 是獨立座標區域**,不與主世界(Palpagos Islands,含帕魯群島+櫻島+Feybreak)共用同一個座標框架/底圖 —— 這點與 Feybreak、Sakurajima 不同(它們仍在主世界同一張圖內,這也是為什麼使用者現有 2048² 底圖已經涵蓋它們)。
- **wiki.gg 目前沒有 World Tree 的 DataMaps / wiki 條目**(上線 6 天,wiki 尚未跟上)。
- **paldb.cc 已有完整可用實作**,技術棧與使用者專案相同(Leaflet + `CRS.Simple` + 線性縮放公式),可直接取得四角校正值、底圖 tile URL、以及一批已知地標的 (世界座標, 地圖座標) 對照。
- **座標判別**:用原始世界座標 `X`(即 wiki.gg 命名的 `DataX`,使用者專案裡的 `savX`)> 349400 幾乎可確定玩家在 World Tree;主世界的 `X` 從未超過 349400。`Y` 軸兩區有較大重疊,不是乾淨的判別軸,建議以 `X` 為主。

---

## 子題 1:世界樹是不是獨立地圖/關卡?

**證據(直接來源,非推論)**:
- paldb.cc 導覽選單明確把地圖分成兩個獨立條目:`/en/Palpagos_Islands`(主世界)與 `/en/The_World_Tree`(世界樹),兩者對應**完全不同**的 JS 資料檔(`map_data_en.js` vs `treemap_data_en.js`)、不同的底圖目錄(`image/map8/` vs `image/treemap8/`)、不同的座標校正 `config` 物件。這是目前找得到最直接的技術證據:世界樹在資料層面被當成獨立地圖處理。
- 社群地圖工具 palworld-map.com 原文:"World Tree and Sunreach remain coordinate-only until regional coordinate frames are calibrated"(世界樹與 Sunreach 的紀錄維持純座標清單,直到區域座標框架校正完成)—— 明確把世界樹稱為需要「獨立區域座標框架」。
  出處:palworld-map.com(WebFetch 摘要,原始頁面為 SPA 未能取得逐字 HTML,此為工具摘要转述,非逐字截圖確認)。
- 官方 1.0 patch notes(palworld.wiki.gg/wiki/1.0.0.100427)描述世界樹是「towering over Palpagos」的終局地區,需完成八個 Tower Boss +解謎任務才能進入;其他玩家攻略提到要抓 Panthalus、透過 Whalaska「穿越屏障」才能到達 —— 暗示特殊傳送/穿越機制,但**未在官方文件中明確使用「獨立關卡/separate level」字眼**。
- 有一則 WebSearch 工具自動彙整的敘述稱「世界樹與 Sky Islands 是自己的可選地圖,進入時遊戲內地圖 UI 會像進入 Sealed Realm/洞穴那樣自動切換」——**這句話我無法在原始網頁(drawpie.com)逐字覆核到**,只在 WebSearch 的統整摘要中出現,標記為「未證實」,不建議引用為確定事實,但方向與其餘證據一致。

**推論**:綜合以上,World Tree 在資料/座標層面是獨立區域,實作上建議視為「第二張獨立底圖」處理(比照 wiki.gg/paldb.cc 的做法),而不是嘗試把它塞進現有主世界 2048² 圖的座標延伸。

---

## 子題 2:底圖資產

### wiki.gg
- 查過 `palworld.wiki.gg` 的 opensearch/API:`World Tree`、`The World Tree`、`Sunreach`、`Sky Island`、`Rotmist Root`、`Forbidden Laboratory`、`Shinespore Root` 等頁面**目前全部是 "missing"(頁面不存在)**。
- wiki.gg 的 DataMaps 基礎頁(`https://palworld.wiki.gg/wiki/Maps`,已用 API 取得完整 wikitext)只列出主世界(Palpagos Islands)的 Map Fragments,沒有世界樹的 fragment。也就是說 **wiki.gg 目前沒有能用的 World Tree DataMaps 資料**。
- 這個頁面同時證實了使用者現有主世界公式的來源與正確性:wiki.gg 也是用 `MapX=(DataY-158000)/459`、`MapY=(DataX+123888)/459`,和使用者現有實作完全一致。

### paldb.cc(可直接用,已驗證)
- 世界樹地圖頁:`https://paldb.cc/en/The_World_Tree`(HTTP 200)。
- 底圖 tile URL 樣式:`https://cdn.paldb.cc/image/treemap8/z{z}x{x}y{y}.webp`(z=zoom 0-4,x/y=tile 索引,tileSize=512px)。
  - 已用 curl 實測驗證:
    - `z0x0y0.webp` → HTTP 200,23,288 bytes
    - `z1x0y0.webp` → HTTP 200,27,214 bytes
    - `z4x0y0.webp`、`z4x15y15.webp` → 不帶 Referer 時 403(hotlink 保護);帶 `Referer: https://paldb.cc/...` 則 200,542 bytes(角落 tile 幾乎全空白,合理,因為方形底圖裡實際地形不會佔滿整個正方形邊界)。
  - **重要**:paldb.cc 的 CDN 有 Referer 檢查,直接從使用者自己的網域 hotlink 大機率會被擋;要重用這些圖需要伺服器端代理/快取,且需考慮該站的使用條款(未查證 ToS 細節,建議實際整合前確認或改用官方素材/自製底圖)。
  - 底圖總尺寸:512px tile × 16×16 tiles(zoom 4 為 native 解析度上限)= **8192×8192 px** 正方形圖。

### 座標校正值(四角,已直接從 paldb.cc 的 `treemap_data_en.js` 取得,非推論)

```json
// World Tree (paldb.cc /js/treemap_data_en.js 內的 var config)
{
  "minMapTextureBlockSize": {"X": 8192, "Y": 8192},
  "landScapeRealPositionMin": {"X": 347351.5, "Y": -818197, "Z": 0},
  "landScapeRealPositionMax": {"X": 689148.5, "Y": -476400, "Z": 0}
}
```

```json
// 主世界 Palpagos Islands (paldb.cc /js/map_data_en.js 內的 var config,同一站、同方法,供比對)
{
  "minMapTextureBlockSize": {"X": 8192, "Y": 8192},
  "landScapeRealPositionMin": {"X": -1099400, "Y": -724400, "Z": 1},
  "landScapeRealPositionMax": {"X": 349400, "Y": 724400, "Z": 1}
}
```

paldb.cc 的座標轉換邏輯(從 `https://cdn.paldb.cc/js/treemap.2a7f4740755fca0c.js` 反解出,完整邏輯與 Leaflet `CRS.Simple` 一致):

```js
rposToScale(o) {
  return {
    X: (o.X - config.landScapeRealPositionMin.X) / (config.landScapeRealPositionMax.X - config.landScapeRealPositionMin.X),
    Y: (o.Y - config.landScapeRealPositionMin.Y) / (config.landScapeRealPositionMax.Y - config.landScapeRealPositionMin.Y)
  };
}
projTpos(o) {
  return [ o.Y * blockSize.Y, (1 - o.X) * blockSize.X ]; // -> [pixelX, pixelY],餵給 Leaflet map.unproject()
}
```

換算成使用者現有公式的風格(若要用 N×N 像素的正方形底圖,線性公式):

```
scaleX = (savY - (-818197)) / (689148.5 - 347351.5)   // World Tree 是用 Y 決定橫軸(和主世界一樣有 flip)
scaleY = 1 - (savX - 347351.5) / (689148.5 - 347351.5)
mapPixelX = scaleX * N
mapPixelY = scaleY * N
```

**注意**:上面的常數(347351.5 等)是 paldb.cc 自己底圖裁切範圍的四角,不是遊戲資料表本身的「絕對」邊界(儘管很接近真實地形範圍)。若使用者不是直接拿 paldb 的 tile 當底圖,而是另外找/自製一張世界樹底圖,就必須依照那張圖實際裁切到的邊界重新校正這兩個常數 —— 跟主世界的 2048² 圖並非 wiki.gg/paldb 的原始裁切範圍是同樣道理。

---

## 子題 3:座標判別(玩家在世界樹時,原始世界座標大概落在什麼範圍)

**已知世界樹內地標的原始座標**(來源:paldb.cc `treemap_data_en.js`,`fixedDungeon` 陣列,7 個 Alpha Pal + NPC + Lifmunk Effigy 座標。這 7 個 Alpha 等級 74–79,與 game8.co 的 World Tree 攻略獨立提到的「7 mapped Alpha encounters ranging from level 74 to 79」完全吻合,交叉驗證資料正確):

| 地點/生物 | X | Y | Z |
|---|---|---|---|
| BOSS_GrassGolem (Dualith, Lv75) | 517450 | -626940 | — |
| BOSS_WhiteDeer_Dark (Celesdir Noct, Lv79) | 520440 | -727175 | — |
| BOSS_IceNarwhal_Fire (Whalaska Ignis, Lv74) | 526910 | -581728 | — |
| BOSS_MushroomLady (Mycora, Lv78) | 458095 | -694560 | — |
| BOSS_VolcanoDragon_Ice (Moldron Cryst, Lv78) | 571870 | -733420 | — |
| BOSS_KabukiMan (Renjishi, Lv78) | 601097 | -572063 | — |
| BOSS_DomeArmorDragon (Aegidron, Lv79) | 491581 | -725697 | — |
| NPC World Tree Guardian | 513231.66 | -511084.22 | 43478.9 |
| Lifmunk Effigy(數個) | 407710–512130 | -742460–-511084 | 16250–43478.9 |

**主世界 vs 世界樹的邊界比較(同一資料來源 paldb.cc,直接可比)**:

- 主世界 X ∈ [-1,099,400, 349,400],世界樹 X ∈ [347,351.5, 689,148.5]
- 主世界 Y ∈ [-724,400, 724,400],世界樹 Y ∈ [-818,197, -476,400]

兩個方框只在一個極窄的角落重疊:X∈[347351.5, 349400](寬度僅約 2048,相對主世界寬度 1,448,800 只占 0.14%)且同時 Y∈[-724400,-476400]。這個重疊角落極小,且落在兩個方形裁切框的邊角(該處實際地形多半是海/空白),實務上不太可能真的撞到同一個可站立座標。

**建議判別規則**:`savX(原始世界座標 X) > 350000` → 幾乎可確定是世界樹;主世界地形從未到達 X=349,400 以上。這比用 Y 軸判別乾淨(Y 軸有 24.8 萬單位的真實重疊帶,主世界南側海岸與世界樹方框在 Y 軸大範圍重疊)。

**未驗證但值得一試的更強訊號**:世界樹內地標的 Z(高度)集中在 16,250–43,478.9,遠高於一般主世界地面高度的印象值。若使用者的 REST API / 存檔解析能拿到 Z,`Z` 可能是更乾淨的判別軸(「World Tree towering over Palpagos」——世界樹被描述為高聳),但**本次研究沒有直接查到主世界地面 Z 的分佈基準來做嚴謹對比**,建議實測驗證(例如撈幾筆已知在主世界地面的玩家座標,比較 Z 值分布)。

**最保險做法**:如果 REST API 或存檔格式本身有回報「目前所在關卡/地圖」欄位(例如 level/world identifier),應優先用那個欄位而不是座標範圍推測 —— 座標範圍只是退而求其次的 workaround。本次研究沒有查證 Palworld 官方 REST API(`/v1/api/players`)是否回傳這類欄位,建議直接查官方 REST API 文件或實測確認。

---

## 子題 4:世界座標 → 世界樹地圖座標的轉換公式

見子題 2 的「座標校正值」與轉換邏輯——paldb.cc 已經有完整、可直接抄的公式與四角校正值,原理與使用者現有主世界公式(線性縮放 + flip)完全一致,只是常數不同。若使用者要用自己的底圖(不是 paldb 的 tile),四角校正值需要依自己那張圖的裁切範圍重新推算,但至少 `landScapeRealPositionMin/Max` 這組「真實世界邊界」數字可以直接沿用作為推算基礎(意義等同 wiki.gg「Setting up the Map's Edges」那段講的 `WorldMapUIData/DT_WorldMapUIData.json` 裡的 `landScapeRealPositionMin/Max`,只是這次是從 paldb.cc 的前端資料反查得到,不是直接从遊戲檔案)。

---

## 其他發現(未在必答子題內,但可能有用)

- Sunreach(另一個 1.0 新地區,「浮在天上」)似乎不在 `The_World_Tree` 這組 config 範圍內獨立列出,paldb.cc 導覽選單也沒有它自己的地圖頁 —— 這次沒有深入研究,若之後要做 Sunreach 建議另開研究。
- th.gl(Hidden Gaming Lair)也有世界樹地圖(`https://palworld.th.gl/maps/The%20World%20Tree`),CDN 上確認存在專屬 tile 目錄 `https://cdn.th.gl/palworld/map-tiles/tree/`(opengraph 預覽圖已驗證 HTTP 200,134,096 bytes,jpeg),但沒有深入反解其 bounds config(时间有限,paldb.cc 的資料已經足夠完整,兩個獨立第三方站都已經把世界樹當成獨立地圖處理,可視為交叉驗證)。
- palworld-coord(GitHub `palworldlol/palworld-coord`)的 DEV.md 只記錄主世界座標系統,未涵蓋 1.0 新地圖。

## 查證方式紀錄(供之後複查)

- palworld.wiki.gg 用其 MediaWiki API(`action=query`/`action=opensearch`)直接查頁面存在性與 wikitext 內容,比網頁爬蟲可靠。
- paldb.cc 的地圖資料是傳統 MediaWiki 風格頁面(非 SPA),直接 curl 拿到的 HTML 裡就有 `<script src="/js/{name}_data_en.js">` 這條路徑規律(`map_data_en.js` = 主世界,`treemap_data_en.js` = 世界樹),該 JS 檔案是單行 minified,但直接用 Python 字串搜尋 `var config` 就能找到四角校正值明碼寫在裡面。
- palworld.gg(Nuxt)與 palworld.th.gl(Next.js)都是重度 client-side render 的 SPA,靜態 curl 拿不到地圖設定,需要真的執行 JS 或找到它們的資料 API(這次沒有進一步深入,時間關係)。
