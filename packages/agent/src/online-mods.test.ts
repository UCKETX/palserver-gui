import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOnlineModPlan, isPublicAddress, parseOnlineModSource } from "./online-mods.js";

test("online mod sources require credential-free HTTPS URLs", () => {
  assert.equal(parseOnlineModSource("https://github.com/example/mod").hostname, "github.com");
  for (const source of [
    "http://example.com/mod.zip",
    "https://user:secret@example.com/mod.zip",
    "not a url",
  ]) {
    assert.throws(() => parseOnlineModSource(source));
  }
});

test("online mod downloads reject private and loopback addresses", () => {
  for (const address of [
    "127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.2",
    "192.0.2.1", "198.51.100.2", "203.0.113.3",
    "::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("builds an install plan for Pak, LogicMods and UE4SS Lua mods", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "online-mod-plan-"));
  try {
    fs.mkdirSync(path.join(root, "bundle", "LogicMods"), { recursive: true });
    fs.mkdirSync(path.join(root, "CoolLua", "Scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "bundle", "Cool.pak"), "pak");
    fs.writeFileSync(path.join(root, "bundle", "Cool.utoc"), "utoc");
    fs.writeFileSync(path.join(root, "bundle", "LogicMods", "Logic.pak"), "pak");
    fs.writeFileSync(path.join(root, "CoolLua", "Scripts", "main.lua"), "return {}\n");
    fs.writeFileSync(path.join(root, "CoolLua", "config.lua"), "return {}\n");

    const plan = buildOnlineModPlan(root);
    assert.deepEqual(plan.pakFiles.sort(), ["Cool.pak", "LogicMods/Logic.pak"]);
    assert.deepEqual(plan.luaMods, ["CoolLua"]);
    assert.ok(plan.files.some((file) => file.destination === "Pal/Content/Paks/Cool.utoc"));
    assert.ok(plan.files.some((file) => file.destination === "Pal/Binaries/Win64/ue4ss/Mods/CoolLua/Scripts/main.lua"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects downloads that do not contain a supported mod", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "online-mod-empty-"));
  try {
    fs.writeFileSync(path.join(root, "README.txt"), "nothing to install");
    assert.throws(() => buildOnlineModPlan(root), /未找到/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
