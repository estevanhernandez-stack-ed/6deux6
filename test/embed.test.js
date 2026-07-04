import { test } from "node:test";
import assert from "node:assert/strict";
import { displayVersion, excerpt, buildEmbed } from "../src/embed.js";

test("displayVersion strips a leading v and one trailing .0 from 4-part versions", () => {
  assert.equal(displayVersion("v1.2.0"), "1.2.0");
  assert.equal(displayVersion("1.8.0.0"), "1.8.0");
  assert.equal(displayVersion("2.0"), "2.0");
  assert.equal(displayVersion("v0.6.0-beta"), "0.6.0-beta");
});

test("excerpt takes the first meaningful paragraph, skipping markdown headers", () => {
  const notes = "## What's new\n\nThreat-model mode ships. Also fixes the gate exit code.\n\n## Details\nMore.";
  assert.equal(excerpt(notes, 300), "Threat-model mode ships. Also fixes the gate exit code.");
});

test("excerpt truncates at maxChars with an ellipsis", () => {
  const out = excerpt("x".repeat(400), 300);
  assert.equal(out.length, 301); // 300 + ellipsis char
  assert.ok(out.endsWith("…"));
});

test("excerpt of empty/null notes is null", () => {
  assert.equal(excerpt(null, 300), null);
  assert.equal(excerpt("## Header only\n\n", 300), null);
});

test("buildEmbed: plugin family, blurb wins over notes excerpt", () => {
  const target = { id: "vibe-sec", family: "plugin" };
  const release = { version: "v0.6.0", url: "https://example.com/r", notes: "Some notes here." };
  const e = buildEmbed(target, release, "The in-voice blurb.");
  assert.equal(e.title, "🚀 vibe-sec 0.6.0");
  assert.equal(e.url, "https://example.com/r");
  assert.equal(e.description, "The in-voice blurb.");
  assert.equal(e.color, parseInt("17d4fa", 16));
  assert.match(e.footer.text, /6deux6 · the 626 Labs release feed · plugin/);
});

test("buildEmbed: store target without notes or blurb uses config blurb via release fallthrough", () => {
  const target = { id: "rororo-store", family: "rororo", blurb: "RORORO — the multi-launcher." };
  const release = { version: "1.8.0.0", url: "https://example.com/s", notes: null };
  const e = buildEmbed(target, release, null);
  assert.equal(e.title, "🚀 rororo-store 1.8.0");
  assert.equal(e.description, "RORORO — the multi-launcher.");
  assert.equal(e.color, parseInt("f22f89", 16));
});
