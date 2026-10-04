# Agent Smith — Hallowed Core

Hallowed Core is the NEW target server. Keep your old server unchanged and invite this newly created bot only to Hallowed Core. Nothing in this project deletes a server, channel, or role. Configure owners through Replit Secrets; owner/reviewer IDs are USER IDs, not guild IDs.

## What is included

Node.js 22.12+ / discord.js 14, PostgreSQL with parameterized SQL and versionable migration source (no ORM required), guild slash commands, durable access requests and audit records, RSS/Atom polling, YouTube feed placeholders, and simple gaming trivia with persistent XP and cosmetic reward tiers. No AI service is involved in permissions. The bot runs as its own long-lived process; there is no web server or public admin endpoint.

| Area | Access | Channels |
|---|---|---|
| START HERE | Everyone | welcome, rules, onboarding |
| SHARED HUB | Rules accepted | announcements, community-help forum, introductions forum, access-requests |
| FAITH | Faith role | lounge, bible-study forum, prayer-and-support forum, news, voice room |
| GAMING | Gaming role | lounge, fighting-games forum, mmo-adventures forum, looking-for-group forum, news, arcade, voice room |
| TECH | Tech role | lounge, projects-and-code forum, hardware-help forum, news, voice room |
| CONTROL ROOM | Configured owners/reviewers | smith-controls, access-review, audit-log, feed-status |

Forums provide threaded conversations; voice rooms are framework-private. There is no stage. Interest roles cover Street Fighter II/IV/V/6, 2XKO, Marvel Tokon, WoW, MnM, other fighters, faith topics, and tech topics. They have zero server permissions and never unlock channels. Customize `src/blueprint.js` before first bootstrap.

## 1. Create the new server and application

1. In Discord, create a NEW server named Hallowed Core that you own. Do not run this against the old server. Enable Developer Mode, then copy the new server ID and the old server ID for the protection denylist.
2. Enable Community in the new server settings so forum channels can be created. Complete Discord's safety, rules-channel, and updates-channel setup. Leave its initial setup channels in place until bootstrap finishes. The new-server guard permits at most six initial channels, five members, and no custom unmanaged roles.
3. Open [Discord Developer Portal](https://discord.com/developers/applications), create an application named **Agent Smith**, and open its Bot page. Create/configure the bot if needed. Copy/reset its token and save it only in Secrets. Disable Public Bot if you want to restrict installations.
4. Enable **Server Members Intent**. Message Content and Presence intents are not needed. Copy the application ID from General Information.
5. In OAuth2 URL Generator / Installation, use Guild Install with `bot` and `applications.commands`. Request View Channels, Read Message History, Send Messages, Send Messages in Threads, Create Public Threads, Add Reactions, Connect, Speak, Manage Channels, Manage Roles, and Manage Threads. Do **not** grant Administrator. Install into the NEW server only.
6. Put Agent Smith's role above all roles it will manage. Bootstrap creates ordinary roles beneath it; check the ordering afterwards. Humans need not receive Manage Roles or Administrator just to review requests.

Discord administrators and the actual server owner can always bypass channel gates. Treat those permissions as trusted manual exceptions. `OWNER_IDS` and `APPROVER_IDS` also explicitly grant the configured humans visibility across communities and the control room; leave approvers empty unless you want that staff access.

## 2. Run in this Replit project

The bot is installed at `apps/agent-smith` as the independent `@workspace/agent-smith` package. This project uses pnpm and Node 24 (the bot requires Node 22.12 or newer). The bot is not part of the API server and has no public web/admin endpoint.

First run these offline checks from the project root. They need no Discord credentials, make no Discord connection, and do not open PostgreSQL:

```sh
pnpm --filter @workspace/agent-smith run test
pnpm --filter @workspace/agent-smith run preflight
pnpm --filter @workspace/agent-smith run discord:register
```

`discord:register` is a command preview unless you explicitly pass `--apply`. Before connecting, add these configuration values through Replit Secrets (never paste tokens into chat or commit them):

| Secret | Value |
|---|---|
| DISCORD_TOKEN | New Agent Smith bot token |
| DISCORD_CLIENT_ID | New application ID |
| DISCORD_GUILD_ID | Hallowed Core's NEW server ID |
| OWNER_IDS | Comma-separated owner USER IDs, including the actual server owner |
| APPROVER_IDS | Optional comma-separated trusted human reviewer IDs |
| DATABASE_URL | Already supplied by Replit's managed PostgreSQL environment; do not replace it casually |
| BOOTSTRAP_CONFIRM_GUILD_ID | Same NEW server ID; required before bot startup or any Discord writes |
| PROTECTED_GUILD_IDS | Old server ID(s), comma-separated; required before bot startup or any Discord writes |

For local use, copy `.env.example` to `.env`. Never commit `.env` or tokens. The target guild's actual owner must appear in `OWNER_IDS`.

After credentials and target IDs have been reviewed, prepare the database and read-only bootstrap plan:

```sh
pnpm --filter @workspace/agent-smith run db:migrate
pnpm --filter @workspace/agent-smith run discord:bootstrap
```

The bootstrap plan connects to Discord to inspect the target, but does not change Discord. Do not run it during the offline preparation phase. Review the target guild ID and names. Only when ready, confirm the target and denylist, then:

```sh
pnpm --filter @workspace/agent-smith run discord:bootstrap --apply
pnpm --filter @workspace/agent-smith run discord:register --apply
pnpm --filter @workspace/agent-smith run discord:audit
```

Bootstrap tracks created IDs in PostgreSQL and skips them on later runs; it does not overwrite manual permission changes. An untracked name collision stops the run. Keep this database: it contains both resource identity and permission approvals. Do not reuse it as a template for another guild without changing guild configuration. Bootstrap serializes concurrent runs.

Audit intentionally reports the initial Community setup channels as unmanaged. After bootstrap, manually choose the generated rules and announcements channels for Community settings if suitable, then review/archive/remove the new server's unused starter channels yourself. Audit never changes permissions or deletes anything. Re-run it until every finding is understood; permission, hierarchy, administrator-bypass, missing-resource, and unrecorded-access findings require operator review.

The separate **Agent Smith Bot** console workflow runs `pnpm --filter @workspace/agent-smith run start`. It is deliberately not started during preparation. Once setup and the live audit are complete, start that workflow. Keep one bot instance initially; feeds are a separate one-shot command, not part of the gateway process.

For continuous production operation, configure a VM/Reserved VM background-worker deployment rather than a sleeping preview or request-driven autoscaling web deployment. Production hosting is not configured by this import. Any future web dashboard must be a separate process with its own authentication; never expose the bot token to it or a browser.

## 3. Member and reviewer workflow

- Member reads #rules and uses `/accept`, which grants the shared-hub Member role.
- `/join framework:Faith|Gaming|Tech` selects exactly one initial framework. Once chosen, a member cannot use it again, even after role removal.
- `/interest` toggles an interest within a framework the member already holds.
- `/request` submits an additional framework request. Duplicate pending requests reuse the same ID. No access is granted at submission.
- Allowlisted humans use `/pending` and `/review id:… approve:true|false` in #access-review or #smith-controls. Self-approval is refused. A second human must review an owner's own request too.
- `/revoke user:… framework:…` is owner-only and removes additional framework access plus its interest roles. Primary framework changes are intentionally a manual owner operation with database reconciliation; they are not self-service.

Discord hides reviewer commands from ordinary users by default. To let an allowlisted reviewer without Manage Server see them, open Server Settings → Integrations → Agent Smith and permit that person to use `/pending` and `/review`. The runtime allowlist still decides authorization even if command visibility is widened. `/revoke` remains owner-only at runtime.

SQL transactions and per-member advisory locks serialize competing requests. Discord API calls and PostgreSQL commits cannot form one atomic transaction: if Discord succeeds and the database commit fails, the audit can flag unrecorded access. Stop onboarding, inspect the Discord audit trail and SQL audit/requests/grants tables, then remove the unexpected role or deliberately reconcile the record. Never retry blindly or grant broad Administrator as a workaround. External manual role changes are reported by audit, not automatically reversed. Run audit after staff permission changes and regularly during operation.

## 4. News, YouTube, and gaming foundations

Edit `feeds.json` with trusted public HTTPS RSS/Atom URLs and enable only the entries you want. The YouTube placeholder uses the channel ID feed format; replace `REPLACE_CHANNEL_ID`. Destinations are restricted to the three framework news channels. Feed configuration is operator-only; do not accept arbitrary member URLs.

Run `pnpm --filter @workspace/agent-smith run feeds:run` separately on a scheduled job (for example every 15 minutes). It polls once and exits, with persistent deduplication and at most five recent items per source per run. First activation may post the latest five entries. Failed feeds return a failing exit status; database audit records successful polls. The feed-status channel is reserved for future operational alerts. A crash after sending but before committing can duplicate an item on the next run; delivery is not exactly-once.

In #arcade, Gaming members use `/trivia`, `/answer`, and `/profile`. One question per minute, one answer per session, two-minute expiry, and 10 XP per correct answer. At 100 XP the profile displays the cosmetic Arcade Regular tier. This is a small sample foundation, not a complete game economy; add a curated question bank and balance before promoting it. XP cannot award access roles, reviewer status, or permissions.

## Validation and recovery

The tests cover framework selection, human allowlists, protected-guild refusal, write confirmations, safe role grants, category visibility, read-only onboarding, and command serialization. The offline preflight checks the full blueprint's visibility grants and confirms no Administrator grant. Role assignment refuses roles with nonzero server permissions or unsafe hierarchy. Live API and PostgreSQL acceptance checks require configuration and have not been run during this import.

Before inviting members, use a normal test account: confirm it sees only START HERE; accept rules and confirm hub access; join one framework; verify both other frameworks remain hidden; attempt a second join; request a second framework; verify only an allowlisted human can approve and that self-approval fails; revoke it; run audit. Test trivia replay/cooldown and feed deduplication. Check a second process cannot concurrently select two frameworks for the same member. Review Discord's View Server As Role as a supplement, not a substitute for the test account.

Back up PostgreSQL before changes. In a partial bootstrap failure, keep the database and rerun the plan. If a Discord create succeeded before its resource record was saved, the name-collision guard will stop: verify the object's identity and permissions before manually recording it or deleting that newly created object. Never wipe the resource table to bypass the guard.

The pinned discord.js release supports Node 22; its HTTP dependency is overridden to patched Undici 6.28.1. Recheck `npm audit` during upgrades. No secrets or production credentials are included.

References: [Discord permissions](https://docs.discord.com/developers/topics/permissions), [application commands](https://docs.discord.com/developers/interactions/application-commands), [discord.js documentation](https://discord.js.org/docs/packages/discord.js/14.25.1).
