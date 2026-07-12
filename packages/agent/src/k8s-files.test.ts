import assert from "node:assert/strict";
import test from "node:test";
import { resolvePodPath } from "./k8s-files.js";

test("resolves safe Pod-relative paths", () => {
  assert.equal(resolvePodPath("Pal/Saved/Config/LinuxServer/Engine.ini"), "/palworld/Pal/Saved/Config/LinuxServer/Engine.ini");
  assert.equal(resolvePodPath("./Pal//Saved"), "/palworld/Pal/Saved");
});

test("rejects Pod path traversal and shell-escape inputs", () => {
  for (const value of ["/etc/passwd", "../secret", "Pal/../secret", "Pal\\Saved"]) {
    assert.throws(() => resolvePodPath(value), /路徑不合法/);
  }
  // A quote is safe because it is passed as an argv value, never interpolated
  // into shell source.
  assert.equal(resolvePodPath("Pal/' && touch /tmp/pwned"), "/palworld/Pal/' && touch /tmp/pwned");
});
