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
const opts = { model: "claude-haiku-5-5", effort: "medium", maxTokens: 2048, maxChars: 300 };

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

test("request carries the model, effort and a cap with room for thinking", async () => {
  const fetchImpl = async (url, req) => {
    const body = JSON.parse(req.body);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.deepEqual(body.output_config, { effort: "medium" });
    assert.equal(body.max_tokens, 2048);
    assert.equal("temperature" in body, false);
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Threat-model mode ships." }] }), { status: 200 });
  };
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl }), "Threat-model mode ships.");
});

test("a thinking block ahead of the text is skipped, not posted", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Threat-model mode ships." }] }), { status: 200 });
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl }), "Threat-model mode ships.");
});

test("a reply cut off at max_tokens → null, never a half sentence", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: "Threat-model mode ships and the" }] }), { status: 200 });
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl }), null);
});

test("a refusal → null", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] }), { status: 200 });
  assert.equal(await makeBlurb(target, release, "voice", { ...opts, apiKey: "k", fetchImpl }), null);
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
