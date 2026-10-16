import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuth } from "../src/auth.js";

const fed = {
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
  ANTHROPIC_ORGANIZATION_ID: "org-uuid",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
  ANTHROPIC_WORKSPACE_ID: "wrkspc_1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://gh.example/token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-tok",
};

test("an API key wins and nothing is fetched", async () => {
  const fetchImpl = async () => { throw new Error("should not be called"); };
  const auth = makeAuth({ ...fed, ANTHROPIC_API_KEY: "k" }, fetchImpl);
  assert.deepEqual(await auth(), { "x-api-key": "k" });
});

test("an empty API key falls through to federation", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return url.startsWith("https://gh.example")
      ? new Response(JSON.stringify({ value: "jwt" }), { status: 200 })
      : new Response(JSON.stringify({ access_token: "sk-ant-oat01-x", expires_in: 600 }), { status: 200 });
  };
  assert.deepEqual(await makeAuth({ ...fed, ANTHROPIC_API_KEY: "" }, fetchImpl)(), { Authorization: "Bearer sk-ant-oat01-x" });
  assert.equal(calls.length, 2);
});

test("federation: GitHub JWT with the Anthropic audience, then the jwt-bearer exchange", async () => {
  const seen = {};
  const fetchImpl = async (url, req) => {
    if (url.startsWith("https://gh.example")) {
      seen.gh = { url, auth: req.headers.Authorization };
      return new Response(JSON.stringify({ value: "jwt" }), { status: 200 });
    }
    seen.exchange = { url, body: JSON.parse(req.body) };
    return new Response(JSON.stringify({ access_token: "sk-ant-oat01-x", token_type: "Bearer", expires_in: 600 }), { status: 200 });
  };
  const headers = await makeAuth(fed, fetchImpl)();
  assert.deepEqual(headers, { Authorization: "Bearer sk-ant-oat01-x" });
  assert.equal(seen.gh.url, "https://gh.example/token?api-version=2.0&audience=https%3A%2F%2Fapi.anthropic.com");
  assert.equal(seen.gh.auth, "Bearer req-tok");
  assert.equal(seen.exchange.url, "https://api.anthropic.com/v1/oauth/token");
  assert.deepEqual(seen.exchange.body, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: "jwt",
    federation_rule_id: "fdrl_1",
    organization_id: "org-uuid",
    service_account_id: "svac_1",
    workspace_id: "wrkspc_1",
  });
});

test("the exchange runs once per process however many blurbs ask", async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    n++;
    return url.startsWith("https://gh.example")
      ? new Response(JSON.stringify({ value: "jwt" }), { status: 200 })
      : new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
  };
  const auth = makeAuth(fed, fetchImpl);
  await auth(); await auth(); await auth();
  assert.equal(n, 2);
});

test("missing federation config → null, nothing fetched", async () => {
  const fetchImpl = async () => { throw new Error("should not be called"); };
  const { ANTHROPIC_FEDERATION_RULE_ID, ...partial } = fed;
  assert.equal(await makeAuth(partial, fetchImpl)(), null);
  assert.equal(await makeAuth({}, fetchImpl)(), null);
});

test("a denied exchange → null", async () => {
  const fetchImpl = async (url) =>
    url.startsWith("https://gh.example")
      ? new Response(JSON.stringify({ value: "jwt" }), { status: 200 })
      : new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "Authentication failed" } }), { status: 401 });
  assert.equal(await makeAuth(fed, fetchImpl)(), null);
});

test("a network failure → null", async () => {
  const fetchImpl = async () => { throw new Error("ECONNRESET"); };
  assert.equal(await makeAuth(fed, fetchImpl)(), null);
});
