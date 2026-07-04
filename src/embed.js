const FAMILY_COLORS = {
  plugin: parseInt("17d4fa", 16),  // cyan
  rororo: parseInt("f22f89", 16),  // magenta
  store: parseInt("8552c2", 16),   // violet — the gradient midpoint
};

/** Display-only normalization; state always stores the raw version.
 * Handles plain (1.2.0), v-prefixed (v1.2.0), product-prefixed monorepo-style
 * tags (vibe-sec-v0.9.0), and 4-part Store versions (1.8.0.0 → 1.8.0). */
export function displayVersion(raw) {
  const m = /^(?:.*?[-_])?v?(\d.*)$/.exec(raw);
  let v = m ? m[1] : raw;
  const fourPart = /^(\d+\.\d+\.\d+)\.0$/.exec(v);
  if (fourPart) v = fourPart[1];
  return v;
}

/** Strip GitHub --generate-notes boilerplate; null when nothing real remains.
 * A body that is only "## What's Changed" + a Full Changelog link is NOT notes —
 * feeding it to the voice makes the model ask questions instead of announcing. */
export function meaningfulNotes(notes) {
  if (!notes) return null;
  const cleaned = notes
    .replace(/^#+\s*What'?s Changed\s*$/gim, "")
    .replace(/^#+\s*New Contributors[\s\S]*?(?=^#|\s*$)/gim, "")
    .replace(/^\*\*Full Changelog\*\*:.*$/gim, "")
    .replace(/^made their first contribution.*$/gim, "")
    .trim();
  return cleaned.length >= 40 ? cleaned : null;
}

/** First meaningful paragraph of release notes; null when there isn't one. */
export function excerpt(notes, maxChars) {
  if (!notes) return null;
  const paragraphs = notes.split(/\r?\n\r?\n/).map((p) => p.trim());
  const meaningful = paragraphs.find((p) => p && !p.startsWith("#"));
  if (!meaningful) return null;
  const flat = meaningful.replace(/\s+/g, " ");
  return flat.length > maxChars ? flat.slice(0, maxChars) + "…" : flat;
}

export function buildEmbed(target, release, blurb) {
  const description =
    blurb ?? excerpt(release.notes, 300) ?? target.blurb ?? "A new version just shipped.";
  const embed = {
    title: `🚀 ${target.id} ${displayVersion(release.version)}`,
    url: release.url,
    description,
    color: FAMILY_COLORS[target.family] ?? FAMILY_COLORS.store,
    footer: { text: `6deux6 · the 626 Labs release feed · ${target.family}` },
  };
  if (target.iconUrl) embed.thumbnail = { url: target.iconUrl };
  return embed;
}
