import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLatestGithub } from "./sources/github.js";
import { fetchLatestStore } from "./sources/displaycatalog.js";
import { findNew } from "./diff.js";
import { buildEmbed } from "./embed.js";
import { makeBlurb } from "./voice.js";
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
  const summary = { announced: [], seeded: [], failed: [] };

  for (const { target, release } of toSeed) {
    summary.seeded.push(target.id);
    if (!dryRun) state[target.id] = { version: release.version, announcedAt: null };
  }

  for (const { target, release } of toAnnounce) {
    // The voice writes from release notes; with none (Store releases), stand
    // down and let the target's curated config blurb carry the embed.
    const blurb = !release.notes ? null : await makeBlurb(target, release, voicePrompt, {
      apiKey: env.ANTHROPIC_API_KEY,
      model: config.voice.model,
      maxChars: config.voice.maxChars,
      fetchImpl,
    });
    const embed = buildEmbed(target, release, blurb);
    if (dryRun) {
      console.log(`[dry-run] would post:\n${JSON.stringify(embed, null, 2)}`);
      summary.announced.push(target.id);
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
  console.log(`announced=${summary.announced.length} seeded=${summary.seeded.length} failed=${summary.failed.length}`);
  return summary;
}

// CLI entry
if (process.argv[1]?.endsWith("index.js")) {
  const dryRun = process.argv.includes("--dry-run");
  run({ dryRun }).then((s) => {
    if (s.failed.length) process.exitCode = 1;
  });
}
