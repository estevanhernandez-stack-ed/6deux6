import { test } from "node:test";
import assert from "node:assert/strict";
import { postEmbed } from "../src/discord.js";

const embed = { title: "🚀 x 1.0.0", description: "d", color: 1, footer: { text: "f" } };

test("posts to the channel messages endpoint with the bot token", async () => {
  let captured;
  const fetchImpl = async (url, req) => {
    captured = { url, req };
    return new Response("{}", { status: 200 });
  };
  await postEmbed("123", embed, { token: "tok", fetchImpl });
  assert.equal(captured.url, "https://discord.com/api/v10/channels/123/messages");
  assert.equal(captured.req.headers.Authorization, "Bot tok");
  assert.deepEqual(JSON.parse(captured.req.body).embeds, [embed]);
});

test("retries once on 429 honoring retry_after", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1)
      return new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 });
    return new Response("{}", { status: 200 });
  };
  await postEmbed("123", embed, { token: "tok", fetchImpl });
  assert.equal(calls, 2);
});

test("throws on 403 (config error a human must see)", async () => {
  const fetchImpl = async () => new Response("missing access", { status: 403 });
  await assert.rejects(() => postEmbed("123", embed, { token: "tok", fetchImpl }), /403/);
});
