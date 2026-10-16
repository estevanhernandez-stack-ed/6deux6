/**
 * Pure diff: which fetched releases are new against committed state?
 * - Unknown target id in state → seed silently (cold start / new watch target),
 *   unless the target sets `announceOnFirstSeen`: then its current release is
 *   announced once. For a target added after it already shipped something
 *   worth a post; the default stays silent so a config change never floods.
 * - Known target, different RAW version string → announce.
 * - null / missing fetch result → leave that target's state untouched.
 */
export function findNew(targets, state, fetchedById) {
  const toAnnounce = [];
  const toSeed = [];
  for (const target of targets) {
    const release = fetchedById[target.id];
    if (!release || !release.version) continue;
    const known = state[target.id];
    if (!known) {
      (target.announceOnFirstSeen ? toAnnounce : toSeed).push({ target, release });
    } else if (known.version !== release.version) {
      toAnnounce.push({ target, release });
    }
  }
  return { toAnnounce, toSeed };
}
