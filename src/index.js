import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLatestGithub } from "./sources/github.js";
import { fetchLatestStore } from "./sources/displaycatalog.js";
import { findNew } from "./diff.js";
import { buildEmbed, displayVersion, meaningfulNotes } from "./embed.js";
import { makeBlurb } from "./voice.js";
import { makeAuth } from "./auth.js";
import { postEmbed } from "./discord.js";
import { loadState, saveState } from "./state.js";

export async function run({ dryRun = false, env = process.env, fetchImpl = fetch, rootDir } = {}) {
  const root = rootDir ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const voicePrompt = await readFile(join(root, "voice.md"), "utf8");
  const statePath = join(root, "state.json");
  const state = await loadState(statePath);

  // Fetch every target; a failure is a null (skip), never a crash.
  const fetchedById = {};
  for (const target of config.targets) {
    fetchedById[target.id] =
      target.source === "github"
        ? await fetchLatestGithub(target, { token: env.GITHUB_TOKEN, fetchImpl })
        : await fetchLatestStore(target, { fetchImpl });
  }

  const { toAnnounce, toSeed } = findNew(config.targets, state, fetchedById);
  const summary = { announced: [], seeded: [], suppressed: [], failed: [] };
  const auth = makeAuth(env, fetchImpl);

  for (const { target, release } of toSeed) {
    summary.seeded.push(target.id);
    if (!dryRun) state[target.id] = { version: release.version, announcedAt: null };
  }

  for (const { target, release } of toAnnounce) {
    // `sameAs`: one product, two sources (GitHub + Store). When the paired
    // target already holds this version, record it here without a second
    // post. The GitHub side wins because its post carries the notes; list it
    // before its Store twin in config.json so a same-run pair resolves.
    const twin = target.sameAs && state[target.sameAs];
    if (twin && displayVersion(twin.version) === displayVersion(release.version)) {
      console.log(`[same-as] ${target.id} ${release.version}: already posted as ${target.sameAs}`);
      summary.suppressed.push(target.id);
      if (!dryRun) state[target.id] = { version: release.version, announcedAt: null, sameAs: target.sameAs };
      continue;
    }
    // The voice writes from real release notes. Boilerplate-only bodies
    // (bare --generate-notes changelog links) and Store releases have none —
    // stand down and let the template / config blurb carry the embed.
    const notes = meaningfulNotes(release.notes);
    // A first post (announceOnFirstSeen) introduces the product, so it gets
    // the voice even with thin notes, and falls back to the product line.
    const firstPost = !state[target.id];
    const blurb = !notes && !firstPost ? null : await makeBlurb(target, { ...release, notes }, voicePrompt, {
      firstPost,
      auth,
      model: config.voice.model,
      effort: config.voice.effort,
      maxTokens: config.voice.maxTokens,
      maxChars: config.voice.maxChars,
      fetchImpl,
    });
    const embed = buildEmbed(target, { ...release, notes }, blurb, { firstPost });
    console.log(`[copy] ${target.id}: ${embed.description}`);
    if (dryRun) {
      console.log(`[dry-run] would post:\n${JSON.stringify(embed, null, 2)}`);
      summary.announced.push(target.id);
      // Track the would-be post so a same-run `sameAs` twin resolves in a dry run too.
      state[target.id] = { version: release.version, announcedAt: "dry-run" };
      continue;
    }
    try {
      await postEmbed(config.channelId, embed, { token: env.DISCORD_TOKEN, fetchImpl });
      state[target.id] = { version: release.version, announcedAt: new Date().toISOString() };
      summary.announced.push(target.id);
    } catch (err) {
      console.error(`[post] ${target.id}: ${err.message}`);
      summary.failed.push(target.id); // state untouched — next run retries
    }
  }

  if (!dryRun) await saveState(statePath, state);
  console.log(`announced=${summary.announced.length} seeded=${summary.seeded.length} ` +
    `suppressed=${summary.suppressed.length} failed=${summary.failed.length}`);
  return summary;
}

// CLI entry
if (process.argv[1]?.endsWith("index.js")) {
  const dryRun = process.argv.includes("--dry-run");
  run({ dryRun }).then((s) => {
    if (s.failed.length) process.exitCode = 1;
  });
}
