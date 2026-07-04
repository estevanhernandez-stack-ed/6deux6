import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBlurb } from "../src/voice.js";

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
