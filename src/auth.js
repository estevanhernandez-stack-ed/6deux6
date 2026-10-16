/**
 * Claude API credentials for the voice layer. Returns a memoized async getter
 * that resolves to request headers, or null when no credential is available.
 *
 * - ANTHROPIC_API_KEY, when set and non-empty, wins (local runs, tests).
 * - Otherwise, in GitHub Actions, Workload Identity Federation: request a fresh
 *   GitHub OIDC token, exchange it at /v1/oauth/token for a short-lived access
 *   token, and send that as a bearer token. No stored secret.
 *
 * The exchange runs at most once per process and only when the first blurb is
 * requested, so an hourly run with nothing to announce never authenticates.
 * Any failure resolves to null: the voice stands down and the template posts.
 */
const API = "https://api.anthropic.com";
const AUDIENCE = "https://api.anthropic.com";

export function makeAuth(env = process.env, fetchImpl = fetch) {
  let pending;
  return () => (pending ??= resolve(env, fetchImpl));
}

async function resolve(env, fetchImpl) {
  if (env.ANTHROPIC_API_KEY) return { "x-api-key": env.ANTHROPIC_API_KEY };

  const ruleId = env.ANTHROPIC_FEDERATION_RULE_ID;
  const orgId = env.ANTHROPIC_ORGANIZATION_ID;
  const serviceAccountId = env.ANTHROPIC_SERVICE_ACCOUNT_ID;
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!ruleId || !orgId || !serviceAccountId || !requestUrl || !requestToken) return null;

  try {
    // A fresh GitHub JWT per exchange: assertions carrying a jti are single-use.
    const idRes = await fetchImpl(`${requestUrl}&audience=${encodeURIComponent(AUDIENCE)}`, {
      headers: { Authorization: `Bearer ${requestToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!idRes.ok) {
      console.error(`[auth] GitHub OIDC token: HTTP ${idRes.status}`);
      return null;
    }
    const assertion = (await idRes.json())?.value;
    if (!assertion) return null;

    const body = {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
      federation_rule_id: ruleId,
      organization_id: orgId,
      service_account_id: serviceAccountId,
    };
    if (env.ANTHROPIC_WORKSPACE_ID) body.workspace_id = env.ANTHROPIC_WORKSPACE_ID;

    const tokRes = await fetchImpl(`${API}/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokRes.ok) {
      // Every denial is an opaque 401; the reason is in the Console's
      // Workload identity > authentication history.
      console.error(`[auth] token exchange: HTTP ${tokRes.status}`);
      return null;
    }
    const accessToken = (await tokRes.json())?.access_token;
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : null;
  } catch (err) {
    console.error(`[auth] ${err.message}`);
    return null;
  }
}
