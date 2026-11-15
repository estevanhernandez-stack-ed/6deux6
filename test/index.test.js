import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.js";

function fakeNet({ discordStatus = 200 } = {}) {
  const posts = [];
  let anthropicCalls = 0;
  let runsCalls = 0;
  const fetchImpl = async (url, req) => {
    if (url.includes("api.anthropic.com")) {
      anthropicCalls++;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "In-voice blurb." }] }), { status: 200 });
    }
    if (url.includes("/actions/workflows/")) {
      runsCalls++;
      return new Response(JSON.stringify({ workflow_runs: [{ id: 7, updated_at: "2026-11-13T05:13:30Z" }] }), { status: 200 });
    }
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify({ tag_name: "v2.0.0", html_url: "https://gh/r", body: "* feat: the big one — full diff-engine rework and cleaner state handling", published_at: null }), { status: 200 });
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
  return { fetchImpl, posts, count: () => anthropicCalls, runsCount: () => runsCalls };
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

async function twinScaffold(state) {
  const dir = await mkdtemp(join(tmpdir(), "6deux6-"));
  const config = {
    channelId: "42",
    voice: { model: "m", maxChars: 300 },
    targets: [
      { id: "app-gh", source: "github", repo: "o/r", family: "store" },
      { id: "app-store", source: "displaycatalog", productId: "9X", family: "store", blurb: "b", sameAs: "app-gh" },
    ],
  };
  await writeFile(join(dir, "config.json"), JSON.stringify(config));
  await writeFile(join(dir, "state.json"), JSON.stringify(state));
  await writeFile(join(dir, "voice.md"), "voice prompt");
  return dir;
}

test("sameAs: GitHub and Store shipping one version in one run post once", async () => {
  // fakeNet serves v2.0.0 on GitHub and 2.0.0.0 on the Store.
  const dir = await twinScaffold({ "app-gh": { version: "v1.0.0" }, "app-store": { version: "1.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.equal(posts.length, 1);
  assert.deepEqual(out.announced, ["app-gh"]);
  assert.deepEqual(out.suppressed, ["app-store"]);
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["app-store"].version, "2.0.0.0");
  assert.equal(state["app-store"].sameAs, "app-gh");
});

test("sameAs: a Store release the GitHub twin already posted stays quiet on a later run", async () => {
  const dir = await twinScaffold({ "app-gh": { version: "v2.0.0" }, "app-store": { version: "1.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.equal(posts.length, 0);
  assert.deepEqual(out.suppressed, ["app-store"]);
});

test("sameAs: a Store version the twin never had still posts", async () => {
  const dir = await twinScaffold({ "app-gh": { version: "v1.9.0" }, "app-store": { version: "1.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  // GitHub moves to v2.0.0 and posts; the Store's 2.0.0.0 matches it and stays quiet.
  // So make GitHub lag: serve its old version back.
  const lagging = async (url, req) =>
    url.includes("api.github.com")
      ? new Response(JSON.stringify({ tag_name: "v1.9.0", html_url: "https://gh/r", body: null }), { status: 200 })
      : fetchImpl(url, req);
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl: lagging, rootDir: dir });
  assert.deepEqual(out.announced, ["app-store"]);
  assert.equal(posts.length, 1);
});

const readLog = async (dir) => JSON.parse(await readFile(join(dir, "store-versions.json"), "utf8")).versions;
const actionsEnv = { DISCORD_TOKEN: "t", GITHUB_REPOSITORY: "o/6deux6", GITHUB_RUN_ID: "8", GITHUB_TOKEN: "g" };
const at = () => new Date("2026-11-13T06:21:58.069Z");

test("store log: a new Store version is logged with when it was seen and the poll before it", async () => {
  const dir = await scaffold({ "gh-one": { version: "v2.0.0" }, "store-one": { version: "1.0.0.0" } });
  const { fetchImpl } = fakeNet();
  await run({ dryRun: false, env: actionsEnv, fetchImpl, rootDir: dir, now: at });
  assert.deepEqual(await readLog(dir), [
    { id: "store-one", productId: "9X", version: "2.0.0.0", firstSeenAt: "2026-11-13T06:21:58.069Z", previousPollAt: "2026-11-13T05:13:30Z" },
  ]);
});

test("store log: a failed post still logs the version, and the retry does not log it twice", async () => {
  const dir = await scaffold({ "gh-one": { version: "v2.0.0" }, "store-one": { version: "1.0.0.0" } });
  const { fetchImpl } = fakeNet({ discordStatus: 403 });
  await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir, now: at });
  await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["store-one"].version, "1.0.0.0"); // the post is still owed
  assert.deepEqual(await readLog(dir), [
    { id: "store-one", productId: "9X", version: "2.0.0.0", firstSeenAt: "2026-11-13T06:21:58.069Z" },
  ]);
});

test("store log: a Store version suppressed as a twin is still logged, with the twin's repo", async () => {
  const dir = await twinScaffold({ "app-gh": { version: "v2.0.0" }, "app-store": { version: "1.0.0.0" } });
  const { fetchImpl, posts } = fakeNet();
  await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir, now: at });
  assert.equal(posts.length, 0);
  assert.deepEqual(await readLog(dir), [
    { id: "app-store", productId: "9X", version: "2.0.0.0", firstSeenAt: "2026-11-13T06:21:58.069Z", twinRepo: "o/r" },
  ]);
});

test("store log: a cold start logs baselines and asks nothing of the Actions API", async () => {
  const dir = await scaffold({});
  const { fetchImpl, runsCount } = fakeNet();
  await run({ dryRun: false, env: actionsEnv, fetchImpl, rootDir: dir, now: at });
  assert.deepEqual(await readLog(dir), [
    { id: "store-one", productId: "9X", version: "2.0.0.0", firstSeenAt: "2026-11-13T06:21:58.069Z", baseline: true },
  ]);
  assert.equal(runsCount(), 0);
});

test("store log: a run with no Store change leaves the file alone", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "2.0.0.0" } });
  const before = '{"versions":[{"id":"store-one","productId":"9X","version":"2.0.0.0","firstSeenAt":"2026-11-01T00:00:00.000Z"}]}';
  await writeFile(join(dir, "store-versions.json"), before);
  const { fetchImpl, runsCount } = fakeNet();
  await run({ dryRun: false, env: actionsEnv, fetchImpl, rootDir: dir });
  assert.equal(await readFile(join(dir, "store-versions.json"), "utf8"), before);
  assert.equal(runsCount(), 0);
});

test("store log: a dry run writes no log", async () => {
  const dir = await scaffold({ "gh-one": { version: "v2.0.0" }, "store-one": { version: "1.0.0.0" } });
  const { fetchImpl, runsCount } = fakeNet();
  await run({ dryRun: true, env: actionsEnv, fetchImpl, rootDir: dir });
  await assert.rejects(readFile(join(dir, "store-versions.json"), "utf8"), { code: "ENOENT" });
  assert.equal(runsCount(), 0);
});

test("store log: an unreadable log does not stop the feed, is left as it was, and fails the run", async () => {
  const dir = await scaffold({ "gh-one": { version: "v1.0.0" }, "store-one": { version: "1.0.0.0" } });
  await writeFile(join(dir, "store-versions.json"), "");
  const { fetchImpl, posts } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.equal(posts.length, 2); // both announcements still went out
  assert.equal(out.storeLogFailed, true);
  assert.equal(await readFile(join(dir, "store-versions.json"), "utf8"), "");
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(state["store-one"].version, "2.0.0.0");
});

test("store log: a healthy run reports the log as fine", async () => {
  const dir = await scaffold({ "gh-one": { version: "v2.0.0" }, "store-one": { version: "1.0.0.0" } });
  const { fetchImpl } = fakeNet();
  const out = await run({ dryRun: false, env: { DISCORD_TOKEN: "t" }, fetchImpl, rootDir: dir });
  assert.equal(out.storeLogFailed, false);
});

test("store log: a version state saw before the log did takes the time state recorded", async () => {
  const dir = await scaffold({ "gh-one": { version: "v2.0.0" }, "store-one": { version: "2.0.0.0", announcedAt: "2026-11-10T15:00:00.000Z" } });
  await writeFile(
    join(dir, "store-versions.json"),
    '{"versions":[{"id":"store-one","productId":"9X","version":"1.0.0.0","firstSeenAt":"2026-11-01T00:00:00.000Z","baseline":true}]}',
  );
  const { fetchImpl, runsCount } = fakeNet();
  await run({ dryRun: false, env: actionsEnv, fetchImpl, rootDir: dir, now: at });
  assert.deepEqual((await readLog(dir))[1], { id: "store-one", productId: "9X", version: "2.0.0.0", firstSeenAt: "2026-11-10T15:00:00.000Z" });
  assert.equal(runsCount(), 0); // the poll before an old sighting is not this run's previous poll
});
