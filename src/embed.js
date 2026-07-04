const FAMILY_COLORS = {
  plugin: parseInt("17d4fa", 16),  // cyan
  rororo: parseInt("f22f89", 16),  // magenta
  store: parseInt("8552c2", 16),   // violet — the gradient midpoint
};

/** Display-only normalization; state always stores the raw version. */
export function displayVersion(raw) {
  let v = raw.startsWith("v") ? raw.slice(1) : raw;
  const fourPart = /^(\d+\.\d+\.\d+)\.0$/.exec(v);
  if (fourPart) v = fourPart[1];
  return v;
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
  return {
    title: `🚀 ${target.id} ${displayVersion(release.version)}`,
    url: release.url,
    description,
    color: FAMILY_COLORS[target.family] ?? FAMILY_COLORS.store,
    footer: { text: `6deux6 · the 626 Labs release feed · ${target.family}` },
  };
}
