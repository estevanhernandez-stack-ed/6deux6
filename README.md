# 6deux6

The 626 Labs release feed for Discord. Watches GitHub Releases and the
Microsoft Store, and posts one branded, in-voice announcement per new
version. REST-only: no gateway, no intents, no message reading, no stored
user data — its whole memory is public version numbers in [state.json](state.json).

Pronounced *six-deux-six*. Yes, that spells 626.

## How it works

An hourly GitHub Action runs one small Node program (zero dependencies):

1. Fetch the latest version per watch target — GitHub `releases/latest`
   or the Microsoft Store display catalog.
2. Diff against `state.json` (committed back after each run).
3. New version → build a branded embed. If an `ANTHROPIC_API_KEY` secret
   is present, Claude writes the announcement from the release notes,
   guided by [voice.md](voice.md); otherwise a template excerpt carries it.
4. Post to the configured channel. State advances only after Discord
   accepts the message — a failed run retries next hour, and nothing ever
   posts twice.

New targets (and brand-new installs) seed silently: announcements start
with the first release *after* adoption.

## Run it for your own projects

1. Fork this repo.
2. Create a Discord application + bot (discord.com/developers), invite it
   to your server with View Channel / Send Messages / Embed Links / Read
   Message History.
3. Edit `config.json`: your channel id, your targets. `github` targets
   need `repo`; `displaycatalog` targets need `productId` (from the app's
   apps.microsoft.com URL).
4. Reset `state.json` to `{}`.
5. Repo secrets: `DISCORD_TOKEN` (required). `ANTHROPIC_API_KEY`
   (optional — enables the LLM voice; without it you get template copy).
6. Replace `voice.md` with your own voice, or keep ours.
7. Enable the workflow (Actions tab). Done.

Local test: `npm run dry-run` prints what would post without posting.

## License

MIT © 626Labs LLC · [Terms](https://626labs.dev/legal/terms.html) ·
[Privacy](https://626labs.dev/legal/privacy.html)

*Imagine Something Else.*
