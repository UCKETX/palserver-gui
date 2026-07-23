import assert from "node:assert/strict";
import test from "node:test";
import { enablePalMod, mapWorkshopResponse, parsePalModSettings, steamLoginSucceeded } from "./steam-workshop.js";

test("parsePalModSettings reads global state and active packages", () => {
  assert.deepEqual(parsePalModSettings([
    "[PalModSettings]",
    "bGlobalEnableMod=false",
    "ActiveModList=Alpha",
    "ActiveModList=Beta=Variant",
  ].join("\r\n")), {
    globalEnabled: false,
    activeMods: ["Alpha", "Beta=Variant"],
  });
});

test("enablePalMod enables globally and de-duplicates package names case-insensitively", () => {
  const output = enablePalMod([
    "[PalModSettings]",
    "bGlobalEnableMod=false",
    "ActiveModList=other",
    "ActiveModList=EXAMPLE",
    "ActiveModList=Other",
  ].join("\n"), "Example");
  assert.equal(output, [
    "[PalModSettings]",
    "bGlobalEnableMod=true",
    "ActiveModList=Example",
    "ActiveModList=other",
    "",
  ].join("\n"));
});

test("mapWorkshopResponse maps details and detects installed updates", () => {
  const result = mapWorkshopResponse({
    response: {
      total: 12,
      next_cursor: "cursor-2",
      publishedfiledetails: [{
        publishedfileid: "1234567890",
        title: "Useful Mod",
        short_description: "[b]Fast[/b] setup",
        preview_url: "https://example.test/preview.jpg",
        tags: [{ tag: "Mod" }, { tag: "Server" }],
        subscriptions: "1500",
        time_updated: 200,
      }],
    },
  }, new Map([["1234567890", 100]]));

  assert.equal(result.total, 12);
  assert.equal(result.nextCursor, "cursor-2");
  assert.equal(result.items[0].summary, "Fast setup");
  assert.equal(result.items[0].installed, true);
  assert.equal(result.items[0].updateAvailable, true);
  assert.deepEqual(result.items[0].tags, ["Mod", "Server"]);
});

test("mapWorkshopResponse safely handles malformed payloads", () => {
  assert.deepEqual(mapWorkshopResponse(null), { items: [], total: 0, pageSize: 0, nextCursor: undefined });
  assert.deepEqual(mapWorkshopResponse({ response: { publishedfiledetails: [null, { publishedfileid: "bad" }] } }).items, []);
});

test("steamLoginSucceeded recognizes cached SteamCMD login output", () => {
  assert.equal(steamLoginSucceeded("Logging in using cached credentials.\nWaiting for user info...OK"), true);
  assert.equal(steamLoginSucceeded("Logging in user 'x' to Steam Public...OK\nWaiting for user info...OK"), true);
  assert.equal(steamLoginSucceeded("FAILED TO LOG IN: password required"), false);
});
