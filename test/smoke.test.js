import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("config.json parses and every target has an id, source, and family", async () => {
  const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
  assert.ok(config.channelId);
  assert.ok(config.targets.length >= 24);
  for (const t of config.targets) {
    assert.ok(t.id && t.family, `bad target ${JSON.stringify(t)}`);
    assert.ok(
      (t.source === "github" && t.repo) || (t.source === "displaycatalog" && t.productId),
      `target ${t.id} missing its source field`
    );
  }
});
