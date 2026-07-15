# 上游 PalworldSaveTools 存檔清理邏輯拆解

來源 pin：`deafdudecomputers/PalworldSaveTools@2c8c65c4a60b04e63eeb7f0c1857a5ba903a24d9`
主檔：`src/palworld_aio/managers/func_manager.py`（2932 行）、`src/palworld_aio/managers/data_manager.py`、`src/palworld_aio/managers/save_manager.py`、`src/palworld_aio/utils.py`、`src/import_libs.py`。

> 重要：`src/palworld_toolsets/modify_save.py` **不是**清理邏輯，它只是啟動外部編輯器（Save Pal / Pal Editor）的 PySide6 GUI。真正的清理在 `palworld_aio/managers/func_manager.py`，透過 `src/palworld_aio/ui/main_window.py` 的 Functions 選單觸發。

## 資料模型與慣例（貫穿全部函式）

- 根路徑：`wsd = loaded_level_json['properties']['worldSaveData']['value']`（以下所有 Section 都在 `wsd` 之下）。
- `normalize_uid(x)`：取 `x['value']`（若 dict）→ `str(x).replace('-','').lower()`。UID 比對一律去連字號＋小寫。
- 遊戲 tick：10,000,000 tick/秒；864,000,000,000 tick/天（= 1e7 × 86400）。
- guild 判定：`g['value']['GroupType']['value']['value'] == 'EPalGroupType::Guild'`。
- `is_valid_level(level)`（utils.py:115）：`int(level) > 0`，否則 False（含解析失敗）。
- `constants.exclusions`：dict，含 `guilds` / `players` / `bases` 三個 UID 清單，使用者可在 GUI「Save Exclusions」設定；比對前 `.replace('-','').lower()`。
- `constants.files_to_delete`：set，累積要刪的玩家 UID；實際刪 `Players/<UID>.sav` 與 `Players/<UID>_dps.sav` 發生在 **存檔時**（save_manager.py:221-227），不是清理函式當下。
- `constants.player_levels`：`build_player_levels()`（func_manager.py:97）從 `CharacterSaveParameterMap` 掃出 `{uid(去連字號): Level}`，只收 `IsPlayer==True` 的 entry。

## GUI 觸發與 days 參數（main_window.py:438 選單、1140+ handlers）

Functions 選單各項對應函式：
- Delete Empty Guilds → `delete_empty_guilds()`（無參數）
- Delete Inactive Bases → `delete_inactive_bases(days)`（`DaysInputDialog` 問天數）
- Delete Duplicate Players → `delete_duplicated_players()`
- Delete Inactive Players → `delete_inactive_players(days)`（問天數）
- Delete Unreferenced Data → `delete_unreferenced_data()`（回 dict 統計）
- Delete Non-Base Map Objects → `delete_non_base_map_objects()`
- Remove Invalid Structures → `delete_invalid_structure_map_objects()`

`parent` 參數只是 Qt 對話框父物件，清理演算法本身**不依賴 Qt**，可純邏輯抽出。唯一 GUI 耦合：天數輸入（`DaysInputDialog.get_days`）與完成後的 `refresh_all()` / cache 失效呼叫（`constants.invalidate_container_lookup()`、`BaseInventoryManager.invalidate_cache()`）——這些在 port 時可忽略或換成自己的重載。

---

## 子題 1：刪除空公會 `delete_empty_guilds()`（func_manager.py:163-208）

「空」定義（兩種都刪）：
1. `RawData.value.players` 陣列為空（:177-179）。
2. 有 players 但**全部 invalid**：每個 player 的 `player_uid`（去連字號）在 `constants.player_levels` 查不到有效等級（`is_valid_level` False）。只要有一個 player level 有效就保留整個公會（:181-198）。空 uid 的 player 視為「有效」→ 不刪（:192-194，`all_invalid=False`）。

排除：gid 命中 `exclusions['guilds']` 直接跳過（:175-176）。

級聯刪除（:201-207，對每個要刪的 guild `g`）：
- 掃 `wsd['BaseCampSaveData']['value']`，凡 `b.value.RawData.value.group_id_belong_to == gid` → 呼叫 `delete_base_camp(b, gid)`（**不帶** `delete_workers`，故 worker 帕魯不刪、只解除歸屬，見子題4）。
- 從 `wsd['GroupSaveDataMap']['value']` 移除該 guild entry。

注意：此函式**不動** `CharacterSaveParameterMap`（不刪玩家帕魯）、不加入 `files_to_delete`（不刪 Players/*.sav）。只清 group + base camp。回傳刪除公會數。

---

## 子題 2：刪除不活躍玩家 `delete_inactive_players(days_threshold)`（func_manager.py:209-268）

「現在」基準（子題6）：`tick_now = wsd['GameTimeSaveData']['value']['RealDateTimeTicks']['value']`（:214）——**存檔內部的世界時鐘**，非真實系統時鐘。

不活躍判定（逐 guild 逐 player，:227-246）：
- `uid = normalize(player.player_uid)`；空 uid → 保留（:230-232）。
- `uid ∈ exclusions['players']` → 保留（:233-235）。
- `last_online = player.player_info.last_online_real_time`。
- `inactive = last_online is not None and (tick_now - last_online) / 864000000000 >= days_threshold`（:239，tick→天）。
- 刪除條件：`inactive OR not is_valid_level(level)`（:240）——即「離線超過門檻天數」**或**「等級無效（<=0 或查無）」。
- 命中 → `to_delete_uids.add(uid)`；否則 `keep_players.append`。

刪除範圍：
- 公會名冊：`raw['players'] = keep_players`（:248）。
- 若某公會 keep 後**沒有 player** → 對其所有 base camp `delete_base_camp(b, gid)`（不帶 delete_workers），並從 GroupSaveDataMap 移除整個公會（:250-256）。
- 若被刪的是 admin：`admin_player_uid` 改指 `keep_players[0]`，並重設 `role`（新 admin=1，其餘=3）（:257-261）。
- `constants.files_to_delete.update(to_delete_uids)`（:263）→ 存檔時刪 `Players/<UID>.sav` + `_dps.sav`。
- `delete_player_pals(wsd, to_delete_uids)`（:264，見子題4）→ 刪這些玩家的帕魯與玩家角色 entry。
- `CharacterSaveParameterMap` 再過濾一次：凡 `key.PlayerUId` 或 `OwnerPlayerUId` 去連字號後 ∈ to_delete_uids 的 entry 全移除（:265-266）。

回傳刪除 UID 數。

---

## 子題 2b：附帶 — 刪除不活躍基地 `delete_inactive_bases(days_threshold)`（:269-308）

- 對每個 guild：`players` 為空 → guild 標記 inactive；否則只要**任一** player 的 `last_online_real_time is None` 或 `(tick - last_online)/1e7/86400 < days_threshold` 就 `all_inactive=False`（:283-290）。全員超門檻才算 inactive guild。
- 掃 `BaseCampSaveData`，`group_id_belong_to ∈ inactive_guild_ids` 且 base_id 不在 `exclusions['bases']` → `delete_base_camp(b, gid)`（:294-301）。只刪基地，不動玩家/公會名冊。

## 子題 2c：附帶 — 刪除重複玩家 `delete_duplicated_players()`（:309-368）

- 同一 uid 出現在多個 guild：保留 `last_online_real_time` 較新（days_inactive 較小）者，刪較舊者的名冊項 + 帕魯（:334-349）。
- `files_to_delete.update(deleted_uids)`、`delete_player_pals`、`clean_character_save_parameter_map`（見子題4）、修 admin。

---

## 子題 3：刪除無參照/孤兒資料 `delete_unreferenced_data()`（func_manager.py:369-594）

回傳 dict：`{characters, pals, guilds, broken_objects, dropped_items, orphaned_dynamic_items, orphaned_works}`。此函式是最複雜的複合清理，動 7 種 Section。分階段：

### A. 建參照集（:382-403）
- `valid_container_ids`：`CharacterContainerSaveData` 每個 `cont.key.ID.value`（normalize）（:387-392）。
- `char_uids`：`CharacterSaveParameterMap` 每個 entry 的 `key.PlayerUId` 與 `value.RawData.value.object.SaveParameter.value.OwnerPlayerUId`（皆 normalize）（:394-403）。

### B. 公會名冊過濾 + 刪空公會（:406-445）
每個 guild：
- player `pid ∉ char_uids` → 加 `unreferenced_uids`，剔除（:414-418）。
- `pid ∈ char_uids` 但 `is_valid_level` False → 加 `invalid_uids`，剔除（:419-424）；level 有效 → 留。
- 若無 valid player 或 all_invalid → 整個 guild 刪：`gid` 加 `deleted_guild_ids`；對其 base camp `delete_base_camp(b, gid_raw, delete_workers=True)`（**帶 delete_workers=True**，連 worker 帕魯一起刪）；從 GroupSaveDataMap 移除（:425-435）。
- 否則 `raw['players'] = valid_players`，修 admin（:437-445）。

### C. 孤兒帕魯（無主 + 容器失效）（:446-464）
非玩家 entry（`IsPlayer` 非真）、`OwnerPlayerUId` 為空或全零、且 `SaveParameter.value.SlotId.value.ContainerId.value.ID` 指向的容器 id **不在** `valid_container_ids` → 加 `orphaned_pals`，從 `char_map` 移除（:447-464）。

### D. 移除 unreferenced/invalid 玩家的角色與帕魯（:465-468）
- `char_map` 過濾掉 `key.PlayerUId` 或 `OwnerPlayerUId` ∈ (unreferenced+invalid) 的 entry（:465）。
- `files_to_delete.update(all_removed_uids)`（:467）。
- `delete_player_pals(wsd, all_removed_uids)`（:468）。

### E. 反向清理殘留參照（避免懸空指標）（:469-510，僅當有移除 uid）
- `MapObjectSaveData.values`：`Model.RawData.value.build_player_uid` 若 ∈ removed → 重設為全零 GUID；`stage_instance_id_belong_to.id` 同理（:470-483）。
- `CharacterContainerSaveData` 每個 slot 的 `RawData.value.player_uid` ∈ removed → 全零（:484-493）。
- `GroupSaveDataMap` 每個 group 的 `RawData.value.individual_character_handle_ids`：剔除 `guid ∈ removed` 的 handle（:494-510）。

### F. 刪 GuildExtraSaveDataMap（:511-513）
`deleted_guild_ids` 對應的 `GuildExtraSaveDataMap` entry 移除（`normalize(entry.key) ∈ deleted_guild_ids`）。

### G. 損壞/掉落 map objects（:514-536）
- `is_broken_mapobject`：`Model.value.BuildProcess.value.RawData.value.state == 0`（建造未完成）。
- `is_dropped_item`：`ConcreteModel.value.RawData.value.concrete_model_type == 'PalMapObjectDropItemModel'`。
- broken 或 dropped 且**不在**排除區（`is_entity_in_exclusion_zones`）且**不是** death bag → 移除；死亡袋（`is_death_bag`）一律保留（:531-534）。
- `MapObjectSaveData.values` 重寫為過濾後清單。

### H. 孤兒 work data（:537-592）
`WorkSaveData.value.values`，逐 entry 檢查 `RawData.value`：
- `base_camp_id_belong_to` 非全零且 ∉ `valid_base_camp_ids`（來自 `BaseCampSaveData` key）→ 剔除。
- `owner_map_object_model_id` / `owner_map_object_concrete_model_id` / `transform.map_object_instance_id` 非全零且 ∉ `valid_instance_ids`（來自過濾後 map objects 的 `instance_id` + `concrete_model_instance_id`）→ 剔除（:562-591）。

### I. 孤兒 dynamic items（:593）
呼叫 `delete_orphaned_dynamic_items()`（見下）。

### 子題 3 補：孤兒 dynamic items `delete_orphaned_dynamic_items()`（:1680-1737）
- `dynamic_ids`：`DynamicItemSaveData.value.values` 每個 `RawData.value.id.local_id_in_created_world`（非全零，normalize）。
- 參照集 `referenced_dynamic_ids`：掃 `ItemContainerSaveData` 與 `CharacterContainerSaveData` 每個容器的 slots，`RawData.value.item.dynamic_id.local_id_in_created_world` 及 `raw.items.value.values[].RawData.dynamic_id.local_id_in_created_world`（:1700-1730）。
- `orphaned = dynamic_ids - referenced`；從 `DynamicItemSaveData.value.values` 移除（:1731-1735）。

---

## 子題 3b：非基地 / 無效結構 map objects

### `delete_non_base_map_objects()`（:627-664）
- `active_base_ids` = `BaseCampSaveData` 每個 `b.key`（normalize）。
- 每個 map object 保留條件（任一）：`is_death_bag`；或 `Model.RawData.value.base_camp_id_belong_to ∈ active_base_ids`；或 `is_entity_in_exclusion_zones`（:642-648）。其餘刪除。
- 刪除時收集 `instance_id` + `concrete_model_instance_id` 到 `deleted_instance_ids`，最後 `_cleanup_orphaned_works(wsd, deleted_instance_ids=...)`（:662-663）。

### `delete_invalid_structure_map_objects()`（:665-710）
同上結構，但保留條件依「MapObjectId 是否在有效資產清單」判定（讀 `constants.get_base_path()` 下的資產表；:668-705），刪除後同樣 `_cleanup_orphaned_works`。

### `_cleanup_orphaned_works(wsd, deleted_instance_ids, deleted_base_camp_ids)`（:595-626）
`WorkSaveData.value.values` 剔除 `RawData.value` 中 `base_camp_id_belong_to ∈ deleted_base_camp_ids` 或 `owner_map_object_model_id`/`owner_map_object_concrete_model_id`/`transform.map_object_instance_id ∈ deleted_instance_ids` 的 entry。

---

## 子題 4：受影響 Section 完整清單 + 必須同步的欄位

### `delete_player_pals(wsd, to_delete_uids)`（:119-143）
- 動 `CharacterSaveParameterMap`：移除 `struct_type ∈ (PalIndividualCharacterSaveParameter, PlayerCharacterSaveParameter)` 且 owner ∈ to_delete_uids 的 entry。
- 用 `ContainerOwnership.build(char_save_map, CharacterContainerSaveData)` 算「有效 owner」（處理帕魯放在別人容器的情況）：`get_effective_owner(InstanceId, owner_uid)`。→ 這是判定歸屬的關鍵，port 時需一併實作容器→owner 映射，否則會漏刪/誤刪寄放帕魯。

### `clean_character_save_parameter_map(data_source, valid_uids)`（:144-162）
- 保留：owner 為空/全零（no_owner），或 `key.PlayerUId ∈ valid_uids`，或 `OwnerPlayerUId ∈ valid_uids`。其餘剔除。

### `delete_base_camp(base_entry, guild_id, level_json, delete_workers=False)`（data_manager.py:133-204）
單一 base camp 的完整級聯，動到的 Section：
1. `MapObjectSaveData.value.values`：移除 `base_camp_id_belong_to == base_id` 的物件（:166）。移除前先從這些物件的 `ConcreteModel.ModuleMap` 收集 `target_container_id`（儲物箱容器）（:159-163）。
2. `ItemContainerSaveData`：移除 key.ID ∈ `cont_ids_to_del`（= worker 容器 `WorkerDirector.RawData.container_id` + 上面收集的 target_container_id）（:167）。
3. `CharacterContainerSaveData`：同上移除（:168）。
4. `WorkSaveData.value.values`：移除 `base_camp_id_belong_to == base_id`（:169-175）。
5. `CharacterSaveParameterMap`（worker 帕魯，:177-197）：SlotId 容器 == worker_cont_id 的非玩家帕魯——`delete_workers=True` → 直接移除；`False` → 保留但把 `SlotId.ContainerId.ID` 與 `group_id` 重設為全零（解除歸屬，帕魯變無主）。
6. `BaseCampSaveData`：移除該 base entry（:198）。
7. **必須同步改的計數/索引**（改 A 不改 B 會壞檔）：對應 guild 的 `RawData.value.base_ids` 與 `map_object_instance_ids_base_camp_points` 陣列，移除該 base_id（:199-204）。

### 全域「必須同步」清單（port 時最容易漏）
| 主刪除 | 必須同步清理 |
|---|---|
| 刪 guild player | admin_player_uid（若刪到 admin，改指第一個 keep player 並重設全員 role：admin=1 其餘=3） |
| 刪 base camp | guild.RawData.base_ids、map_object_instance_ids_base_camp_points |
| 刪 player uid | Players/<UID>.sav + <UID>_dps.sav（存檔時）；CharacterSaveParameterMap（角色+帕魯）；MapObject.build_player_uid / stage_instance_id_belong_to.id（改全零）；CharacterContainer slot.player_uid（改全零）；group.individual_character_handle_ids |
| 刪 guild | GuildExtraSaveDataMap 同 gid entry |
| 刪 map object | WorkSaveData 對應 owner/transform instance id 的 entry |
| 刪 base camp | ItemContainer / CharacterContainer（worker+儲物箱容器）、DynamicItem（經 orphan 掃描） |

頂層 Section 完整清單（清理會動到的）：`GroupSaveDataMap`、`GuildExtraSaveDataMap`、`BaseCampSaveData`、`CharacterSaveParameterMap`、`CharacterContainerSaveData`、`ItemContainerSaveData`、`DynamicItemSaveData`、`MapObjectSaveData`、`WorkSaveData`、`GameTimeSaveData`（唯讀，取 now）。

---

## 子題 5：安全措施與警告

- **自動備份**：載入存檔時（save_manager.py:130-131）呼叫 `backup_whole_directory(current_save_path, 'Backups/AllinOneTools')`。`backup_whole_directory`（import_libs.py:39）複製 `Level.sav`、`LevelMeta.sav`、整個 `Players/` 資料夾到 `<data>/Backups/AllinOneTools/PalworldSave_backup_<YYYYMMDD_HHMMSS>/`。→ 備份發生在**載入時**，不是每次清理前；同一 session 多次清理共用該次載入的備份。
- **延遲刪檔**：`Players/*.sav` 的實體刪除延到 `save_changes()`（save_manager.py:216-228），先寫 Level.sav 再刪玩家檔，最後 `files_to_delete.clear()`。清理函式只標記 uid，不立即刪檔。
- GUI 有紅字警告（modify_save.py:325-327、main_window notice.backup）提示先備份。
- **無 schema 驗證 / 無 dry-run**：清理直接原地改記憶體中的 JSON；除上述備份外無 rollback。函式內大量 `try/except: pass`（靜默吞例外）→ 結構不符時可能默默略過而非報錯。port 時建議改為顯式錯誤或至少記 log。

---

## 子題 6：`last_online_real_time` 的「now」基準（程式碼證據）

**存檔內部世界時鐘，非真實系統時鐘。** 證據：
- `delete_inactive_players`：`tick_now = wsd['GameTimeSaveData']['value']['RealDateTimeTicks']['value']`（func_manager.py:214），比較 `(tick_now - last_online)/864000000000 >= days_threshold`（:239）。
- `delete_inactive_bases`：`tick = wsd['GameTimeSaveData']['value']['RealDateTimeTicks']['value']`（:273），`(tick - last_online)/1e7/86400 < days_threshold`（:286）。
- `delete_duplicated_players`：同樣用 `GameTimeSaveData...RealDateTimeTicks`（:313）。
- 對照：`fix_all_negative_timestamps`（:1242+）與 `reset_selected_player_timestamp`（:1287+）把 `last_online_real_time` 設為 `current_tick`（同一 RealDateTimeTicks），佐證 now 基準就是這欄位。

→ port 時：now 必須取 `worldSaveData.GameTimeSaveData.value.RealDateTimeTicks.value`，**不可**用 `Date.now()`。此欄是玩家最後存檔時的世界時間 tick。

---

## 推論標註

- 以上規則除本節外皆為**上游程式碼明載**（附行號）。
- 「tick=10^7/秒」為 Palworld 通用常數（由 864000000000/86400 反推，與上游除數一致）——推論，但被程式碼除數佐證。
- `ContainerOwnership.build` / `get_effective_owner` 的內部細節未在本次展開（在 func_manager 匯入的 helper）；只確認其用途為「帕魯有效歸屬解析」。port 前需另讀該類實作。
- `is_entity_in_exclusion_zones`（:87）依座標判斷是否在保護區，細節未展開。
