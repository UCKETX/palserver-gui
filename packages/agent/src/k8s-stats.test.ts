import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCpuPercent,
  parseCpuAcctUsageMicros,
  parseCpuMaxCores,
  parseCpuQuotaCores,
  parseCpuStatUsageMicros,
  computeContainerUptimeSeconds,
  parseProcStatStartTicks,
  parseMemoryLimit,
} from "./k8s.js";

test("parses cgroup v2 CPU and memory fields", () => {
  assert.equal(parseCpuStatUsageMicros("usage_usec 250000\nuser_usec 100"), 250000);
  assert.equal(parseCpuMaxCores("400000 100000", "processor : 0\nprocessor : 1"), 4);
  assert.equal(parseMemoryLimit("16777216"), 16777216);
  assert.equal(parseMemoryLimit("max"), 0);
});

test("parses cgroup v1 fallbacks", () => {
  assert.equal(parseCpuAcctUsageMicros("2000000\n"), 2000);
  assert.equal(parseCpuQuotaCores("200000", "100000", "processor : 0"), 2);
  assert.equal(parseCpuQuotaCores("-1", "100000", "processor : 0\nprocessor : 1"), 2);
  assert.equal(parseMemoryLimit("9223372036854771712"), 0);
});

test("computes CPU from two cumulative samples", () => {
  const previous = { podName: "palworld-0", usageMicros: 1_000_000, atMs: 1_000 };
  assert.equal(computeCpuPercent(previous, 1_500_000, 2_000), 50);
  assert.equal(computeCpuPercent(previous, 900_000, 2_000), null);
  assert.equal(computeCpuPercent(undefined, 1_500_000, 2_000), null);
});

test("computes container uptime from PID 1 start ticks", () => {
  const fields = Array.from({ length: 21 }, (_, index) => String(index + 1));
  fields[0] = "S";
  fields[19] = "900";
  assert.equal(parseProcStatStartTicks(`1 (test process) ${fields.join(" ")}`), 900);
  assert.equal(computeContainerUptimeSeconds(100, 900, 100), 91);
});
