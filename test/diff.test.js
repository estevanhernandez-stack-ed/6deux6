import { test } from "node:test";
import assert from "node:assert/strict";
import { findNew } from "../src/diff.js";

const target = { id: "vibe-sec", source: "github", repo: "x/vibe-sec", family: "plugin" };
const rel = (version) => ({ version, url: "https://example.com", notes: "notes", publishedAt: null });

test("known target with a changed version is announced", () => {
  const out = findNew([target], { "vibe-sec": { version: "v1.0.0" } }, { "vibe-sec": rel("v1.1.0") });
  assert.equal(out.toAnnounce.length, 1);
  assert.equal(out.toAnnounce[0].release.version, "v1.1.0");
  assert.equal(out.toSeed.length, 0);
});

test("known target with the same version does nothing", () => {
  const out = findNew([target], { "vibe-sec": { version: "v1.1.0" } }, { "vibe-sec": rel("v1.1.0") });
  assert.equal(out.toAnnounce.length, 0);
  assert.equal(out.toSeed.length, 0);
});

test("unknown target is seeded, never announced (cold start)", () => {
  const out = findNew([target], {}, { "vibe-sec": rel("v1.1.0") });
  assert.equal(out.toAnnounce.length, 0);
  assert.equal(out.toSeed.length, 1);
  assert.equal(out.toSeed[0].release.version, "v1.1.0");
});

test("null fetch result (no releases yet / fetch failed) touches nothing", () => {
  const out = findNew([target], { "vibe-sec": { version: "v1.0.0" } }, { "vibe-sec": null });
  assert.equal(out.toAnnounce.length, 0);
  assert.equal(out.toSeed.length, 0);
});

test("target missing from fetched map entirely touches nothing", () => {
  const out = findNew([target], {}, {});
  assert.equal(out.toAnnounce.length, 0);
  assert.equal(out.toSeed.length, 0);
});
