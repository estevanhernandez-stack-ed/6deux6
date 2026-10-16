/**
 * Latest published release for a GitHub target.
 * - Default: GET /releases/latest (GitHub's own pick: newest non-draft,
 *   non-prerelease).
 * - With `tagPattern` (a regex string): the newest non-draft, non-prerelease
 *   release whose tag matches, from the last 30. For repos that ship more
 *   than one line from one repo, e.g. Sanduhr's `v2.x-mac` beside `v3.x`.
 */
export async function fetchLatestGithub(target, { token, fetchImpl = fetch } = {}) {
  try {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "6deux6" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const path = target.tagPattern ? "releases?per_page=30" : "releases/latest";
    const res = await fetchImpl(`https://api.github.com/repos/${target.repo}/${path}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null; // no releases yet — normal, stay quiet
    if (!res.ok) {
      console.error(`[github] ${target.id}: HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    const rel = target.tagPattern ? pickMatching(body, target.tagPattern) : body;
    if (!rel?.tag_name) return null;
    return {
      version: rel.tag_name,
      url: rel.html_url,
      notes: rel.body ?? null,
      publishedAt: rel.published_at ?? null,
    };
  } catch (err) {
    console.error(`[github] ${target.id}: ${err.message}`);
    return null;
  }
}

/** GitHub lists releases newest first; take the first published one that matches. */
function pickMatching(releases, tagPattern) {
  const re = new RegExp(tagPattern);
  return (Array.isArray(releases) ? releases : []).find(
    (r) => !r.draft && !r.prerelease && re.test(r.tag_name ?? ""),
  ) ?? null;
}
