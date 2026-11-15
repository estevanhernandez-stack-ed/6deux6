// One-time: builds store-versions.json from the git history of state.json.
// Every Store version this feed ever saw landed in a state.json commit, so the
// history is the record of when each one was first seen.
//
//   node scripts/backfill-store-versions.js
//
// It refuses to run when the log already has rows, and there is no flag to
// override that. Once the feed is logging live, the log knows more than
// history does: versions whose post never landed, the true first sighting
// where history only has the post time, and each row's previousPollAt. A
// rebuild would throw all of that away. To rebuild anyway, delete the file by
// hand first.
//
// Set GITHUB_TOKEN (or GH_TOKEN) to also fill previousPollAt from the poll
// workflow's run history; without one the public API's rate limit applies.
// Never prints the token.
//
// Three limits on what history can say:
// - announcedAt is when the post landed, a few seconds after the poll saw the
//   version. If a post failed and went out on a later run, it is that later
//   time. A version stored with no time takes its commit's time.
// - The first version a product appears with is a baseline: it was live before
//   this feed watched it, or it was an introduction post, and either way it is
//   no evidence of the day it shipped.
// - State was reset to a 0.0.0.0 placeholder on the feed's first day to force
//   test posts. Those commits and the trip back are dropped by the same rule
//   the live log uses: a version counts only if it is higher than any before.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHigher, isTime, loadStoreLog, saveStoreLog, twinRepoOf } from "../src/storelog.js";

const LOOKBACK_MS = 6 * 3_600_000;

/** Pure. `snapshots` are state.json at each commit, oldest first: [{ committedAt, state }]. */
export function rowsFromHistory(snapshots, targets) {
  const rows = [];
  for (const target of targets) {
    if (target.source !== "displaycatalog") continue;
    let highest;
    for (const { committedAt, state } of snapshots) {
      const entry = state?.[target.id];
      // Same rule as the live log: only a version higher than any before it.
      if (!entry?.version || !isHigher(entry.version, highest)) continue;
      const row = {
        id: target.id,
        productId: target.productId,
        version: entry.version,
        firstSeenAt: isTime(entry.announcedAt) ? entry.announcedAt : committedAt,
      };
      if (highest === undefined) row.baseline = true;
      const twinRepo = twinRepoOf(target, targets);
      if (twinRepo) row.twinRepo = twinRepo;
      rows.push(row);
      highest = entry.version;
    }
  }
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => Date.parse(a.row.firstSeenAt) - Date.parse(b.row.firstSeenAt) || a.i - b.i)
    .map(({ row }) => row);
}

/** Pure. The newest run that finished before the sighting; the run that made the sighting finished after it. */
export function pickPreviousRun(runs, firstSeenAt) {
  const seen = Date.parse(firstSeenAt);
  const before = (Array.isArray(runs) ? runs : [])
    .map((run) => run?.updated_at)
    .filter((at) => isTime(at) && Date.parse(at) < seen)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return before[0] ?? null;
}

async function previousPollBefore(firstSeenAt, { repository, token }) {
  const to = new Date(firstSeenAt);
  const from = new Date(to.getTime() - LOOKBACK_MS);
  const created = `${from.toISOString().slice(0, 19)}Z..${to.toISOString().slice(0, 19)}Z`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "6deux6" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${repository}/actions/workflows/poll.yml/runs?status=success&event=schedule&per_page=20&created=${encodeURIComponent(created)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`[backfill] run history for ${firstSeenAt}: HTTP ${res.status}`);
    return null;
  }
  return pickPreviousRun((await res.json())?.workflow_runs, firstSeenAt);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readSnapshots(root) {
  const commits = git(root, "log", "--reverse", "--format=%H %cI", "--", "state.json").trim().split("\n").filter(Boolean);
  const snapshots = [];
  for (const line of commits) {
    const [hash, committedAt] = line.split(" ");
    try {
      snapshots.push({ committedAt: new Date(committedAt).toISOString(), state: JSON.parse(git(root, "show", `${hash}:state.json`)) });
    } catch {
      // A commit that deleted state.json or left it unparseable has nothing to say.
    }
  }
  return snapshots;
}

function repositoryOf(root) {
  const url = git(root, "remote", "get-url", "origin").trim();
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const logPath = join(root, "store-versions.json");
  const existing = await loadStoreLog(logPath);
  if (existing.versions.length) {
    console.error(`[backfill] ${logPath} already has ${existing.versions.length} rows; a rebuild would lose what the live log knows. Delete the file by hand to rebuild.`);
    process.exitCode = 1;
    return;
  }
  const { targets } = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const snapshots = readSnapshots(root);
  const rows = rowsFromHistory(snapshots, targets);

  const repository = process.env.GITHUB_REPOSITORY ?? repositoryOf(root);
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  let bounded = 0;
  if (repository) {
    for (const row of rows) {
      if (row.baseline) continue;
      const previousPollAt = await previousPollBefore(row.firstSeenAt, { repository, token });
      if (previousPollAt) {
        row.previousPollAt = previousPollAt;
        bounded++;
      }
    }
  }
  await saveStoreLog(logPath, { versions: rows });
  const ships = rows.filter((row) => !row.baseline).length;
  console.log(`[backfill] ${snapshots.length} state commits -> ${rows.length} rows (${ships} ships, ${rows.length - ships} baselines, ${bounded} with a previous poll)`);
}

if (process.argv[1]?.endsWith("backfill-store-versions.js")) await main();
