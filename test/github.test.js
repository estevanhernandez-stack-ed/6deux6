import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchLatestGithub } from "../src/sources/github.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/github-release.json", import.meta.url), "utf8"));
const target = { id: "vibe-sec", source: "github", repo: "estevanhernandez-stack-ed/vibe-sec", family: "plugin" };

test("maps a release: raw tag, url, notes, publishedAt", async () => {
  const fetchImpl = async (url, opts) => {
    assert.match(url, /repos\/estevanhernandez-stack-ed\/vibe-sec\/releases\/latest/);
    assert.equal(opts.headers.Authorization, "Bearer tok");
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  const rel = await fetchLatestGithub(target, { token: "tok", fetchImpl });
  assert.equal(rel.version, "v0.6.0");
  assert.equal(rel.url, fixture.html_url);
  assert.match(rel.notes, /Threat-model/);
});

test("404 (no releases yet) returns null quietly", async () => {
  const fetchImpl = async () => new Response("{}", { status: 404 });
  assert.equal(await fetchLatestGithub(target, { token: "tok", fetchImpl }), null);
});

test("works without a token (header omitted)", async () => {
  const fetchImpl = async (url, opts) => {
    assert.equal(opts.headers.Authorization, undefined);
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  const rel = await fetchLatestGithub(target, { fetchImpl });
  assert.equal(rel.version, "v0.6.0");
});
