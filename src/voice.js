/**
 * The personality layer. Returns an in-voice blurb, or null on ANY failure —
 * absent key, timeout, API error, empty output. Null means: use the template
 * fallback. The voice can delay a post by one API call; it can never block one.
 */
export async function makeBlurb(target, release, voicePrompt, { apiKey, model, maxChars, fetchImpl = fetch }) {
  if (!apiKey) return null;
  try {
    const user = [
      `Product: ${target.id} (family: ${target.family})`,
      `Version: ${release.version}`,
      `Release notes:\n${release.notes ?? "(none — Store release, no notes published)"}`,
    ].join("\n\n");
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 200, system: voicePrompt, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[voice] ${target.id}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = data?.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) return null;
    return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
  } catch (err) {
    console.error(`[voice] ${target.id}: ${err.message}`);
    return null;
  }
}
