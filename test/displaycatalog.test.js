import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseVersions, fetchLatestStore } from "../src/sources/displaycatalog.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/displaycatalog.json", import.meta.url), "utf8"));
const target = { id: "rororo-store", source: "displaycatalog", productId: "9NMJCS390KWB", family: "rororo" };

test("parseVersions extracts all 4-part versions", () => {
  assert.deepEqual(parseVersions(fixture.Products[0]), ["1.8.0.0", "1.7.2.0"]);
});

test("fetchLatestStore returns the highest version and the product URL", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(fixture), { status: 200 });
  const rel = await fetchLatestStore(target, { fetchImpl });
  assert.equal(rel.version, "1.8.0.0");
  assert.equal(rel.url, "https://apps.microsoft.com/detail/9NMJCS390KWB");
  assert.equal(rel.notes, null);
});

test("fetchLatestStore returns null on HTTP failure", async () => {
  const fetchImpl = async () => new Response("nope", { status: 500 });
  assert.equal(await fetchLatestStore(target, { fetchImpl }), null);
});

test("fetchLatestStore returns null when no version parses", async () => {
  const broken = { Products: [{ DisplaySkuAvailabilities: [{ Sku: { Properties: { Packages: [{ PackageFullName: "garbage" }] } } }] }] };
  const fetchImpl = async () => new Response(JSON.stringify(broken), { status: 200 });
  assert.equal(await fetchLatestStore(target, { fetchImpl }), null);
});
