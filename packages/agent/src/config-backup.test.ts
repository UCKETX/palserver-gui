import assert from "node:assert/strict";
import test from "node:test";
import { isSafeConfigSnapshotId, validateConfigIni } from "./config-backup.js";

test("accepts generated snapshot ids and rejects paths", () => {
  assert.equal(isSafeConfigSnapshotId("m1abc-0123456789abcdef"), true);
  assert.equal(isSafeConfigSnapshotId("../escape"), false);
  assert.equal(isSafeConfigSnapshotId("m1abc-0123456789abcdeg"), false);
});

test("validates world and engine INI structure", () => {
  assert.doesNotThrow(() => validateConfigIni(
    "PalWorldSettings.ini",
    "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\\\"test\\\")\n",
  ));
  assert.doesNotThrow(() => validateConfigIni("Engine.ini", "[/Script/Engine.GameEngine]\nMaxFPS=60\n"));
  assert.throws(() => validateConfigIni("PalWorldSettings.ini", "[broken\nOptionSettings=(x)"), /設定快照內容無效/);
});
