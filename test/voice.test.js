import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBlurb, isAnnouncement } from "../src/voice.js";

test("isAnnouncement rejects questions and operator-addressed meta output", () => {
  assert.equal(isAnnouncement("Could you share what changed in v1.10.1?"), false);
  assert.equal(isAnnouncement("I'd be happy to write that announcement."), false);
  assert.equal(isAnnouncement("I need the actual release notes content."), false);
  assert.equal(isAnnouncement("Threat-model mode ships, and the gate exits honest."), true);
});

test("makeBlurb rejects a clarifying-question response and falls back to null", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "Could you share what changed? Bug fixes? New features?" }] }), { status: 200 });
  const out = await makeBlurb({ id: "x", family: "plugin" }, { version: "v1", url: "u", notes: "n" }, "voice", { model: "m", maxChars: 300, apiKey: "k", fetchImpl });
  assert.equal(out, null);
});

const target = { id: "vibe-sec", family: "plugin" };
const release = { version: "v0.6.0", url: "https://x", notes: "Threat-model mode ships." };
const opts = { model: "claude-haiku-4-5-20251001", maxChars: 300 };

test("no api key → null, no fetch attempted", async () => {
  const fetchImpl = async () => { throw new Error("should not be called"); };
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: undefined, fetchImpl }), null);
});

test("happy path returns trimmed text", async () => {
  const fetchImpl = async (url, req) => {
    assert.match(url, /api\.anthropic\.com/);
    const body = JSON.parse(req.body);
    assert.equal(body.system, "voice");
    return new Response(JSON.stringify({ content: [{ type: "text", text: "  Threat-model mode ships, and the gate exits honest. " }] }), { status: 200 });
  };
  const out = await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl });
  assert.equal(out, "Threat-model mode ships, and the gate exits honest.");
});

test("API error → null", async () => {
  const fetchImpl = async () => new Response("overloaded", { status: 529 });
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl }), null);
});

test("over-long model output is hard-capped with ellipsis", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "y".repeat(400) }] }), { status: 200 });
  const out = await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl });
  assert.equal(out.length, 301);
  assert.ok(out.endsWith("…"));
});
