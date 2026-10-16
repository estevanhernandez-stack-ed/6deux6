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

test("tagPattern picks the newest published release whose tag matches", async () => {
  const listed = [
    { tag_name: "v3.5.0", html_url: "w", body: "windows", draft: false, prerelease: false },
    { tag_name: "v2.26.0-mac", html_url: "d", body: "draft", draft: true, prerelease: false },
    { tag_name: "v2.25.1-mac", html_url: "p", body: "pre", draft: false, prerelease: true },
    { tag_name: "v2.25.0-mac", html_url: "m", body: "mac notes", draft: false, prerelease: false, published_at: "2026-10-16T00:00:00Z" },
  ];
  const fetchImpl = async (url) => {
    assert.match(url, /repos\/o\/sanduhr\/releases\?per_page=30$/);
    return new Response(JSON.stringify(listed), { status: 200 });
  };
  const rel = await fetchLatestGithub({ id: "sanduhr-mac", repo: "o/sanduhr", tagPattern: "-mac$" }, { fetchImpl });
  assert.equal(rel.version, "v2.25.0-mac");
  assert.equal(rel.notes, "mac notes");
});

test("tagPattern with no match returns null", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([{ tag_name: "v3.5.0", draft: false, prerelease: false }]), { status: 200 });
  assert.equal(await fetchLatestGithub({ id: "x", repo: "o/r", tagPattern: "-mac$" }, { fetchImpl }), null);
});
