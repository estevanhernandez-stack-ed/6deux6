import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPreviousRun, rowsFromHistory } from "../scripts/backfill-store-versions.js";

const targets = [
  { id: "app-gh", source: "github", repo: "o/app" },
  { id: "app-store", source: "displaycatalog", productId: "9APP", sameAs: "app-gh" },
  { id: "solo-store", source: "displaycatalog", productId: "9SOLO" },
];

test("history: the first version seen is a baseline and each change after it is a ship", () => {
  const rows = rowsFromHistory(
    [
      { committedAt: "2026-09-15T04:25:00Z", state: { "solo-store": { version: "1.0.0.0", announcedAt: null } } },
      { committedAt: "2026-09-20T10:00:00Z", state: { "solo-store": { version: "1.0.0.0", announcedAt: null } } },
      { committedAt: "2026-10-01T12:31:00Z", state: { "solo-store": { version: "1.1.0.0", announcedAt: "2026-10-01T12:30:25.434Z" } } },
    ],
    targets,
  );
  assert.deepEqual(rows, [
    { id: "solo-store", productId: "9SOLO", version: "1.0.0.0", firstSeenAt: "2026-09-15T04:25:00Z", baseline: true },
    { id: "solo-store", productId: "9SOLO", version: "1.1.0.0", firstSeenAt: "2026-10-01T12:30:25.434Z" },
  ]);
});

test("history: a version stored with no time takes the commit's time", () => {
  const rows = rowsFromHistory(
    [
      { committedAt: "2026-09-15T04:25:00Z", state: { "app-store": { version: "1.0.0.0", announcedAt: "2026-09-15T04:24:46.969Z" } } },
      { committedAt: "2026-10-16T21:17:00Z", state: { "app-store": { version: "2.0.0.0", announcedAt: null, sameAs: "app-gh" } } },
    ],
    targets,
  );
  assert.deepEqual(rows[1], { id: "app-store", productId: "9APP", version: "2.0.0.0", firstSeenAt: "2026-10-16T21:17:00Z", twinRepo: "o/app" });
});

test("history: rows from every product come out in time order, and GitHub targets are left out", () => {
  const rows = rowsFromHistory(
    [
      { committedAt: "2026-09-01T00:00:00Z", state: { "app-gh": { version: "v1.0.0" }, "solo-store": { version: "1.0.0.0" } } },
      { committedAt: "2026-09-02T00:00:00Z", state: { "app-gh": { version: "v2.0.0" }, "solo-store": { version: "1.0.0.0" }, "app-store": { version: "2.0.0.0" } } },
      { committedAt: "2026-09-03T00:00:00Z", state: { "solo-store": { version: "1.1.0.0" }, "app-store": { version: "2.0.0.0" } } },
    ],
    targets,
  );
  assert.deepEqual(rows.map((r) => `${r.id} ${r.version}`), ["solo-store 1.0.0.0", "app-store 2.0.0.0", "solo-store 1.1.0.0"]);
});

test("history: a placeholder reset and the trip back to the real version are not ships", () => {
  // The feed's first day: state was reset to 0.0.0.0 to force a test post, then
  // re-announced the version it already had.
  const rows = rowsFromHistory(
    [
      { committedAt: "2026-07-04T03:02:42Z", state: { "solo-store": { version: "3.1.0.0", announcedAt: null } } },
      { committedAt: "2026-07-04T03:18:55Z", state: { "solo-store": { version: "0.0.0.0", announcedAt: null } } },
      { committedAt: "2026-07-04T03:19:51Z", state: { "solo-store": { version: "3.1.0.0", announcedAt: "2026-07-04T03:19:50.339Z" } } },
      { committedAt: "2026-07-14T14:42:00Z", state: { "solo-store": { version: "3.2.0.0", announcedAt: "2026-07-14T14:41:40.363Z" } } },
    ],
    targets,
  );
  assert.deepEqual(rows.map((r) => [r.version, r.baseline === true]), [["3.1.0.0", true], ["3.2.0.0", false]]);
});

test("previous run: the newest successful run that finished before the sighting", () => {
  const runs = [
    { updated_at: "2026-11-13T06:22:02Z" }, // the run that saw it: finished after
    { updated_at: "2026-11-13T05:13:30Z" },
    { updated_at: "2026-11-13T04:15:42Z" },
  ];
  assert.equal(pickPreviousRun(runs, "2026-11-13T06:21:58.069Z"), "2026-11-13T05:13:30Z");
  assert.equal(pickPreviousRun([...runs].reverse(), "2026-11-13T06:21:58.069Z"), "2026-11-13T05:13:30Z");
});

test("previous run: unknown when no run on record finished before the sighting", () => {
  assert.equal(pickPreviousRun([{ updated_at: "2026-11-13T06:22:02Z" }], "2026-11-13T06:21:58.069Z"), null);
  assert.equal(pickPreviousRun([], "2026-11-13T06:21:58.069Z"), null);
  assert.equal(pickPreviousRun(undefined, "2026-11-13T06:21:58.069Z"), null);
});
