/** Output validation: the blurb is posted verbatim in public, so anything that
 * reads as a question, a meta-comment, or the model addressing an operator is
 * rejected — the template fallback always beats a clarifying question in the
 * release feed. (Learned live 2026-07-04: thin notes made the model ask
 * "could you share what changed?" thirteen times, in production.) */
export function isAnnouncement(text) {
  if (text.includes("?")) return false;
  if (/\b(I need|I'd need|I'd be happy|I would|could you|can you|please share|release notes|announcement|changelog link|as an AI)\b/i.test(text)) return false;
  if (/^i\b/i.test(text)) return false;
  return true;
}

/**
 * The personality layer. Returns an in-voice blurb, or null on ANY failure —
 * absent key, timeout, API error, empty output, or output that fails
 * validation. Null means: use the template fallback. The voice can delay a
 * post by one API call; it can never block one.
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
    if (!text || !isAnnouncement(text)) {
      if (text) console.error(`[voice] ${target.id}: rejected non-announcement output`);
      return null;
    }
    return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
  } catch (err) {
    console.error(`[voice] ${target.id}: ${err.message}`);
    return null;
  }
}
