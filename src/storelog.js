import { readFile, writeFile } from "node:fs/promises";

/**
 * store-versions.json: an append-only log of every Microsoft Store version
 * this feed has seen, and when. state.json cannot answer "when did that
 * version go live": it keeps only the latest version per target, and a version
 * recorded under its GitHub twin or seeded on first sight has no time at all.
 *
 * A row: { id, productId, version, firstSeenAt, previousPollAt?, baseline?, twinRepo? }
 * - firstSeenAt: when a poll first saw the version in the catalog. The poll is
 *   hourly, so the version went live at some point in the hour before it.
 * - previousPollAt: when the last successful scheduled poll run before that
 *   one finished. With firstSeenAt it bounds when the version went live. A run
 *   counts as successful even if that one product's catalog read failed in it,
 *   so the bound is the run's, not the product's.
 * - baseline: the version was already live when this log started watching it,
 *   so the row says nothing about when it shipped. Readers skip these when
 *   counting ship days and use them only to know the newest version.
 * - twinRepo: the GitHub repo that releases the same product (`sameAs`).
 */

const ROW_KEYS = ["id", "productId", "version", "firstSeenAt", "previousPollAt", "baseline", "twinRepo"];
const POLL_WORKFLOW = "poll.yml";

export const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

const isRow = (row) =>
  row !== null && typeof row === "object" && typeof row.id === "string" && typeof row.version === "string" && isTime(row.firstSeenAt);

/**
 * A missing file is an empty log. A file that is there but is not a version
 * log throws: reading it as empty would have the next row overwrite the whole
 * history, and would turn every watched product back into a baseline.
 */
export async function loadStoreLog(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { versions: [] };
    throw err;
  }
  const versions = JSON.parse(text)?.versions;
  if (!Array.isArray(versions) || !versions.every(isRow)) throw new Error("not a version log");
  return { versions };
}

/** One row per line, so a new version is a one-line diff. Keys this code does not know are kept. */
export async function saveStoreLog(path, log) {
  const lines = log.versions.map((row) => {
    const keys = [...ROW_KEYS, ...Object.keys(row).filter((k) => !ROW_KEYS.includes(k))];
    return "    " + JSON.stringify(Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]])));
  });
  const body = lines.length ? `[\n${lines.join(",\n")}\n  ]` : "[]";
  await writeFile(path, `{\n  "versions": ${body}\n}\n`);
}

/** Store versions are four numbers; compares them part by part. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The Store only ever moves a product forward, so a version counts once: the
 * first time it is seen, and only if it is higher than every version seen
 * before it. A lower one showing up is the catalog flapping or a package being
 * pulled, and the version it flaps back to has already been counted.
 */
export const isHigher = (version, highest) => highest === undefined || compareVersions(version, highest) > 0;

/** The highest version the log holds for a target, or undefined. */
export const highestLogged = (log, id) =>
  log.versions.reduce((top, row) => (row.id === id && isHigher(row.version, top) ? row.version : top), undefined);

/** The GitHub repo that releases the same product as a Store target, or null. */
export const twinRepoOf = (target, targets) =>
  (target.sameAs && targets.find((t) => t.id === target.sameAs && t.source === "github")?.repo) || null;

/**
 * Pure: the rows this run adds. Compared against the log itself, not state, so
 * a version is recorded the first time it is seen whatever happens to its
 * post (announced, suppressed as a twin, or failed and retried next hour), and
 * never a second time.
 * `state` must be the state as loaded, before this run changes it.
 */
export function planStoreRows({ targets, state, fetchedById, log, now }) {
  const rows = [];
  for (const target of targets) {
    if (target.source !== "displaycatalog") continue;
    const version = fetchedById[target.id]?.version;
    if (!version) continue;
    const logged = log.versions.filter((row) => row.id === target.id);
    if (!isHigher(version, highestLogged(log, target.id))) continue;

    const row = { id: target.id, productId: target.productId, version, firstSeenAt: now };
    const known = state[target.id];
    if (!known || (!logged.length && known.version === version)) {
      // Nothing to measure it against: a target this feed has only just
      // started watching, or a version state already held when a new or lost
      // log first met it. State's time is when a post last landed, not when
      // the version went live, so on its own it proves no day.
      row.baseline = true;
    } else if (known.version === version) {
      // State saw this version on an earlier run and the log missed it (the
      // gap between a backfill and its merge). Take the time state recorded
      // when it can be true: after the last row logged, and not in the future.
      // Otherwise the log's own first sighting is now.
      const at = Date.parse(known.announcedAt);
      const lastLogged = Math.max(...logged.map((r) => Date.parse(r.firstSeenAt)));
      if (isTime(known.announcedAt) && at > lastLogged && at <= Date.parse(now)) row.firstSeenAt = known.announcedAt;
    }
    const twinRepo = twinRepoOf(target, targets);
    if (twinRepo) row.twinRepo = twinRepo;
    rows.push(row);
  }
  return rows;
}

/**
 * Pure: targets whose catalog version is below the highest one logged. Nothing
 * is logged for them, and without a line saying so a wrong high row in the log
 * would block every later version in silence.
 */
export function belowLogged({ targets, fetchedById, log }) {
  const out = [];
  for (const target of targets) {
    if (target.source !== "displaycatalog") continue;
    const version = fetchedById[target.id]?.version;
    const highest = highestLogged(log, target.id);
    if (version && highest !== undefined && compareVersions(version, highest) < 0) out.push({ id: target.id, version, highest });
  }
  return out;
}

/**
 * When the last successful scheduled poll run before this one finished, from
 * the Actions API. Scheduled runs only: a manual run can be the credential
 * check, which succeeds without polling anything. Best effort: null outside
 * Actions or on any failure, and a null never holds up the log or the poll.
 */
export async function fetchPreviousPollAt({ repository, runId, token, fetchImpl = fetch } = {}) {
  if (!repository) return null;
  try {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "6deux6" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${POLL_WORKFLOW}/runs?status=success&event=schedule&per_page=5`;
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[storelog] previous poll: HTTP ${res.status}`);
      return null;
    }
    const runs = (await res.json())?.workflow_runs;
    const previous = (Array.isArray(runs) ? runs : []).find((run) => String(run.id) !== String(runId));
    return isTime(previous?.updated_at) ? previous.updated_at : null;
  } catch (err) {
    console.error(`[storelog] previous poll: ${err.message}`);
    return null;
  }
}
