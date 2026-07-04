import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.js";

function fakeNet({ discordStatus = 200 } = {}) {
  const posts = [];
  let anthropicCalls = 0;
  const fetchImpl = async (url, req) => {
    if (url.includes("api.anthropic.com")) {
      anthropicCalls++;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "In-voice blurb." }] }), { status: 200 });
    }
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify({ tag_name: "v2.0.0", html_url: "https://gh/r", body: "Big one.", published_at: null }), { status: 200 });
    }
    if (url.includes("displaycatalog")) {
      return new Response(JSON.stringify({ Products: [{ DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFullName: "X_2.0.0.0_x64__h" }] } } }] }] }), { status: 200 });
    }
    if (url.includes("discord.com")) {
      posts.push(JSON.parse(req.body));
      return new Response("{}", { status: discordStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, posts, count: () => anthropicCalls };
}

async function scaffold(state) {
  const dir = await mkdtemp(join(tmpdir(), "6deux6-"));
  const config = {
    channelId: "42",
    voice: { model: "m", maxChars: 300 },
    targets: [
      { id: "gh-one", source: "github", repo: "o/r", family: "plugin" },
      { id: "store-one", source: "displaycatalog", productId: "9X", family: "store", blurb: "b" },
    ],
  };
  await writeFile(join(dir, "config.json"), JSON.stringify(config));
  await writeFile(join(dir, "state.json"), JSON.stringify(state));
  await writeFile(join(dir, "voice.md"), "voice prompt");
  return dir;
}

test("cold start seeds everything and posts nothing", async () => {
  const dir = await scaffold({});
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.deepEqual(out.seeded.sort(), ["gh-one", "store-one"]);
  assert.equal(posts.length, 0);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["gh-one"].version, "v2.0.0");
  assert.equal(state["store-one"].version, "2.0.0.0");
});

test("new version announces and advances state", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "2.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.deepEqual(out.announced, ["gh-one"]);
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].title, /gh-one 2\.0\.0/);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["gh-one"].version, "v2.0.0");
});

test("failed Discord post does NOT advance state", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "2.0.0.0" } });
  const { fetchImpl } = fakeNet({ discordStatus: 403 });
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.deepEqual(out.failed, ["gh-one"]);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["gh-one"].version, "v1.0.0"); // untouched — retries next run
});

test("voice runs only for releases with notes; Store targets use config blurbs", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "1.0.0.0" } });
  const { fetchImpl, posts, count } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t", ANTHROPIC_API_KEY: "k" }, fetchImpl, rootDir: dir });
  assert.deepEqual(out.announced.sort(), ["gh-one", "store-one"]);
  assert.equal(count(), 1); // one call for gh-one (has notes), none for store-one
  const storePost = posts.map((p) => p.embeds[0]).find((e) => e.title.includes("store-one"));
  assert.equal(storePost.description, "b"); // the config blurb
  const ghPost = posts.map((p) => p.embeds[0]).find((e) => e.title.includes("gh-one"));
  assert.equal(ghPost.description, "In-voice blurb.");
});

test("dry run posts nothing and writes nothing", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "2.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: true, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.deepEqual(out.announced, ["gh-one"]);
  assert.equal(posts.length, 0);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["gh-one"].version, "v1.0.0");
});
