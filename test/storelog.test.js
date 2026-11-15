import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, fetchPreviousPollAt, loadStoreLog, planStoreRows, saveStoreLog } from "../src/storelog.js";

const NOW = "2026-11-13T06:21:58.069Z";
const targets = [
  { id: "app-gh", source: "github", repo: "o/app" },
  { id: "app-store", source: "displaycatalog", productId: "9APP", sameAs: "app-gh" },
  { id: "solo-store", source: "displaycatalog", productId: "9SOLO" },
];
const fetched = (versions) =>
  Object.fromEntries(Object.entries(versions).map(([id, version]) => [id, version && { version }]));
const plan = ({ state = {}, versions = {}, rows = [] }) =>
  planStoreRows({ targets, state, fetchedById: fetched(versions), log: { versions: rows }, now: NOW });

test("a new version of a watched product is one row, dated now", () => {
  const rows = plan({
    state: { "solo-store": { version: "1.0.0.0", announcedAt: "2026-11-01T00:00:00.000Z" } },
    versions: { "solo-store": "1.1.0.0" },
    rows: [{ id: "solo-store", productId: "9SOLO", version: "1.0.0.0", firstSeenAt: "2026-11-01T00:00:00.000Z" }],
  });
  assert.deepEqual(rows, [{ id: "solo-store", productId: "9SOLO", version: "1.1.0.0", firstSeenAt: NOW }]);
});

test("the version already at the end of the log adds nothing", () => {
  const rows = plan({
    state: { "solo-store": { version: "1.0.0.0" } },
    versions: { "solo-store": "1.1.0.0" },
    rows: [{ id: "solo-store", productId: "9SOLO", version: "1.1.0.0", firstSeenAt: "2026-11-12T00:00:00.000Z" }],
  });
  assert.deepEqual(rows, []);
});

test("a product seen for the first time is a baseline, not a ship", () => {
  const rows = plan({ versions: { "solo-store": "1.0.0.0" } });
  assert.deepEqual(rows, [{ id: "solo-store", productId: "9SOLO", version: "1.0.0.0", firstSeenAt: NOW, baseline: true }]);
});

test("a version state already holds is dated from state, not from now", () => {
  const rows = plan({
    state: { "solo-store": { version: "1.1.0.0", announcedAt: "2026-11-10T15:00:00.000Z" } },
    versions: { "solo-store": "1.1.0.0" },
    rows: [{ id: "solo-store", productId: "9SOLO", version: "1.0.0.0", firstSeenAt: "2026-11-01T00:00:00.000Z" }],
  });
  assert.deepEqual(rows, [{ id: "solo-store", productId: "9SOLO", version: "1.1.0.0", firstSeenAt: "2026-11-10T15:00:00.000Z" }]);
});

test("a version state holds with no time is a baseline", () => {
  for (const announcedAt of [null, "dry-run", undefined]) {
    const rows = plan({ state: { "solo-store": { version: "1.1.0.0", announcedAt } }, versions: { "solo-store": "1.1.0.0" } });
    assert.deepEqual(rows, [{ id: "solo-store", productId: "9SOLO", version: "1.1.0.0", firstSeenAt: NOW, baseline: true }]);
  }
});

test("a failed catalog read adds nothing", () => {
  assert.deepEqual(plan({ state: { "solo-store": { version: "1.0.0.0" } }, versions: { "solo-store": null } }), []);
});

test("GitHub targets are never logged", () => {
  assert.deepEqual(plan({ state: { "app-gh": { version: "v1.0.0" } }, versions: { "app-gh": "v2.0.0" } }), []);
});

test("a product with a GitHub twin carries the twin's repo", () => {
  const rows = plan({ state: { "app-store": { version: "1.0.0.0" } }, versions: { "app-store": "2.0.0.0" } });
  assert.deepEqual(rows, [{ id: "app-store", productId: "9APP", version: "2.0.0.0", firstSeenAt: NOW, twinRepo: "o/app" }]);
});

test("a version no higher than one already logged is not a ship", () => {
  // The Store only ever moves a product forward. A lower version showing up is
  // the catalog flapping or a package being pulled, and the version it flaps
  // back to was already counted.
  const logged = [
    { id: "solo-store", productId: "9SOLO", version: "1.9.0.0", firstSeenAt: "2026-11-01T00:00:00.000Z" },
    { id: "solo-store", productId: "9SOLO", version: "1.10.0.0", firstSeenAt: "2026-11-02T00:00:00.000Z" },
  ];
  for (const version of ["1.9.0.0", "1.2.0.0", "0.0.0.0", "1.10.0.0"]) {
    assert.deepEqual(plan({ state: { "solo-store": { version: "1.10.0.0" } }, versions: { "solo-store": version }, rows: logged }), []);
  }
  const higher = plan({ state: { "solo-store": { version: "1.10.0.0" } }, versions: { "solo-store": "1.10.1.0" }, rows: logged });
  assert.equal(higher.length, 1);
});

test("versions compare by number, part by part", () => {
  assert.ok(compareVersions("1.10.0.0", "1.9.0.0") > 0);
  assert.ok(compareVersions("4.8.0.0", "4.8.0.0") === 0);
  assert.ok(compareVersions("0.28.1.0", "0.28.0.0") > 0);
  assert.ok(compareVersions("3.9.1.0", "4.0.0.0") < 0);
});

test("a missing or empty log file reads as an empty log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "6deux6-log-"));
  assert.deepEqual(await loadStoreLog(join(dir, "nope.json")), { versions: [] });
  await writeFile(join(dir, "odd.json"), JSON.stringify({ versions: "x" }));
  assert.deepEqual(await loadStoreLog(join(dir, "odd.json")), { versions: [] });
});

test("the log is written one row per line, in a fixed key order, and reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "6deux6-log-"));
  const path = join(dir, "store-versions.json");
  const log = {
    versions: [
      { baseline: true, firstSeenAt: "2026-11-01T00:00:00.000Z", version: "1.0.0.0", productId: "9SOLO", id: "solo-store" },
      { id: "app-store", productId: "9APP", version: "2.0.0.0", firstSeenAt: NOW, twinRepo: "o/app", previousPollAt: "2026-11-13T05:13:30Z" },
    ],
  };
  await saveStoreLog(path, log);
  const text = await readFile(path, "utf8");
  assert.equal(
    text,
    '{\n  "versions": [\n' +
      '    {"id":"solo-store","productId":"9SOLO","version":"1.0.0.0","firstSeenAt":"2026-11-01T00:00:00.000Z","baseline":true},\n' +
      `    {"id":"app-store","productId":"9APP","version":"2.0.0.0","firstSeenAt":"${NOW}","previousPollAt":"2026-11-13T05:13:30Z","twinRepo":"o/app"}\n` +
      "  ]\n}\n",
  );
  assert.deepEqual((await loadStoreLog(path)).versions.map((r) => r.version), ["1.0.0.0", "2.0.0.0"]);
});

test("an empty log is still valid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "6deux6-log-"));
  const path = join(dir, "store-versions.json");
  await saveStoreLog(path, { versions: [] });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { versions: [] });
});

const runsResponse = (runs, status = 200) => async (url, req) => {
  runsResponse.last = { url, req };
  return new Response(JSON.stringify({ workflow_runs: runs }), { status });
};

test("the previous poll is the newest successful run that is not this one", async () => {
  const fetchImpl = runsResponse([
    { id: 30, updated_at: "2026-11-13T06:22:02Z" },
    { id: 29, updated_at: "2026-11-13T05:13:30Z" },
    { id: 28, updated_at: "2026-11-13T04:15:42Z" },
  ]);
  const at = await fetchPreviousPollAt({ repository: "o/6deux6", runId: "30", token: "t", fetchImpl });
  assert.equal(at, "2026-11-13T05:13:30Z");
  assert.match(runsResponse.last.url, /repos\/o\/6deux6\/actions\/workflows\/poll\.yml\/runs\?status=success/);
  assert.equal(runsResponse.last.req.headers.Authorization, "Bearer t");
});

test("the previous poll is unknown outside Actions, on an HTTP error, or when the call throws", async () => {
  const never = async () => { throw new Error("should not be called"); };
  assert.equal(await fetchPreviousPollAt({ repository: undefined, runId: "1", fetchImpl: never }), null);
  assert.equal(await fetchPreviousPollAt({ repository: "o/r", runId: "1", fetchImpl: runsResponse([], 403) }), null);
  assert.equal(await fetchPreviousPollAt({ repository: "o/r", runId: "1", fetchImpl: runsResponse([]) }), null);
  assert.equal(await fetchPreviousPollAt({ repository: "o/r", runId: "1", fetchImpl: never }), null);
});
