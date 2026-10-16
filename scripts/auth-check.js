// Resolves the voice credential the way a real run does, then makes one cheap
// authenticated call (list one model). Prints which path was used and whether
// it worked; never prints a token. Run from the workflow's auth_check input.
import { makeAuth } from "../src/auth.js";

const path = process.env.ANTHROPIC_API_KEY ? "API key" : "Workload Identity Federation";
const headers = await makeAuth()();
if (!headers) {
  console.error(`[auth-check] ${path}: no credential (check the repo variables, or the Console's authentication history)`);
  process.exit(1);
}
const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
  headers: { ...headers, "anthropic-version": "2023-06-01" },
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) {
  console.error(`[auth-check] ${path}: credential obtained, API call returned HTTP ${res.status}`);
  process.exit(1);
}
console.log(`[auth-check] ${path}: OK`);
