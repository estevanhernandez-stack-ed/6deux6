export async function fetchLatestGithub(target, { token, fetchImpl = fetch } = {}) {
  try {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "6deux6" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`https://api.github.com/repos/${target.repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null; // no releases yet — normal, stay quiet
    if (!res.ok) {
      console.error(`[github] ${target.id}: HTTP ${res.status}`);
      return null;
    }
    const rel = await res.json();
    if (!rel.tag_name) return null;
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
