# Agent Smith — Hallowed Core

Hallowed Core is the NEW target server. Keep your old server unchanged and invite this newly created bot only to Hallowed Core. Nothing in this project deletes a server, channel, or role. Configure owners through Replit Secrets; owner/reviewer IDs are USER IDs, not guild IDs.

## What is included

Node.js 22.12+ / discord.js 14, PostgreSQL with parameterized SQL and versionable migration source (no ORM required), guild slash commands, durable access requests and audit records, RSS/Atom polling, YouTube feed placeholders, gaming trivia, and independent seven-rank framework progression. No AI service is involved in permissions or XP scoring. The bot runs as its own long-lived process; there is no web server or public admin endpoint.

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

1. Use the confirmed Hallowed Core server you own. Both target settings must equal the fixed authorized ID `1556423230590423042`; connections to any other server are refused. The user confirmed the old server was deleted, so no old-server ID or denylist is required.
2. Enable Community in the new server settings so forum channels can be created. Complete Discord's safety, rules-channel, and updates-channel setup. Leave its initial setup channels in place until bootstrap finishes. The new-server guard permits at most six initial channels, five members, and no custom unmanaged roles.
3. Open [Discord Developer Portal](https://discord.com/developers/applications), create an application named **Agent Smith**, and open its Bot page. Create/configure the bot if needed. Copy/reset its token and save it only in Secrets. Disable Public Bot if you want to restrict installations.
4. Enable **Server Members Intent**. Message Content and Presence intents are not needed. Copy the application ID from General Information.
5. In OAuth2 URL Generator / Installation, use Guild Install with `bot` and `applications.commands`. Request View Channels, Read Message History, Send Messages, Send Messages in Threads, Create Public Threads, Add Reactions, Connect, Speak, Manage Channels, Manage Roles, and Manage Threads. Do **not** grant Administrator. Install into the NEW server only.
6. Put Agent Smith's role above all roles it will manage. Bootstrap creates ordinary roles beneath it; check the ordering afterwards. Humans need not receive Manage Roles or Administrator just to review requests.

Discord administrators and the actual server owner can always bypass channel gates. Treat those permissions as trusted manual exceptions. `OWNER_IDS` and `APPROVER_IDS` also explicitly grant the configured humans visibility across communities and the control room; leave approvers empty unless you want that staff access.

## 2. Run in this Replit project

The bot is installed at `apps/agent-smith` as the independent `@workspace/agent-smith` package. This project uses pnpm and Node 24 (the bot requires Node 22.12 or newer). The bot is not part of the API server and has no public web/admin endpoint.

### Development: no VM or publishing required

Use the **Agent Smith Bot** console workflow / Run button. It starts only the
Gateway bot, not the template API or canvas service. The equivalent root command
is `pnpm run bot`; do not launch it while that workflow is already running.
Keep one bot instance against the live server.

Root shortcuts:

| Command | Behavior |
|---|---|
| `pnpm run bot` | Run the bot independently |
| `pnpm run bootstrap` | Inspect the live target and preview setup; no Discord writes |
| `pnpm run register-commands` | Offline slash-command preview |
| `pnpm run bot:test` | Offline unit and isolated interaction tests |
| `pnpm run bot:preflight` | Offline blueprint/permission checks |
| `pnpm run bot:audit` | Live read-only permission/access audit |

Pass `--apply` only when intentionally performing an authorized setup or
registration operation, e.g. `pnpm run register-commands -- --apply`.
Starting the bot does not bootstrap, register commands, migrate the database,
or publish anything. The existing server is already provisioned: do not repeat
the first-install steps below just to start or test the bot.

The template API and canvas workflows are optional and can remain stopped.
Their files are retained for future use; neither is an HTTP keep-alive service
for the bot. Post-merge setup installs locked dependencies only: it does not run
the template Drizzle schema push or change the bot's database.

### First-install reference

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
| DISCORD_GUILD_ID | Must equal the fixed authorized Hallowed Core ID |
| OWNER_IDS | Comma-separated owner USER IDs, including the actual server owner |
| APPROVER_IDS | Optional comma-separated trusted human reviewer IDs |
| DATABASE_URL | Already supplied by Replit's managed PostgreSQL environment; do not replace it casually |
| BOOTSTRAP_CONFIRM_GUILD_ID | Must equal the same fixed authorized Hallowed Core ID before any connection |

For local use, copy `.env.example` to `.env`. Never commit `.env` or tokens. The target guild's actual owner must appear in `OWNER_IDS`.

After credentials and target IDs have been reviewed, prepare the database and read-only bootstrap plan:

```sh
pnpm --filter @workspace/agent-smith run db:migrate
pnpm --filter @workspace/agent-smith run discord:bootstrap
```

The bootstrap plan connects to Discord to inspect only the fixed authorized target, but does not change Discord. It checks the owner allowlist, Community feature, initial clean-server condition, and required bot permissions before approving the plan. If Community is disabled, enable it in Server Settings → Enable Community and complete Discord's setup before continuing. The user authorized applying the planned resources to this target:

```sh
pnpm --filter @workspace/agent-smith run discord:bootstrap --apply
pnpm --filter @workspace/agent-smith run discord:register --apply
pnpm --filter @workspace/agent-smith run discord:audit
```

Bootstrap tracks created IDs in PostgreSQL and skips them on later runs; it does not overwrite manual permission changes. The sole adoption exception is the existing #rules text channel designated in Discord Community settings: bootstrap moves it into START HERE, applies the planned public/read-only permissions, preserves existing messages, and tracks its ID. It preserves and tracks the Discord-designated private #moderator-only Community Updates channel without editing it. Unexpected identities, duplicate rules channels, public updates visibility, or any other untracked name collision stop the run. Keep this database: it contains both resource identity and permission approvals. Do not reuse it as a template for another guild without changing guild configuration. Bootstrap serializes concurrent runs.

Audit verifies the adopted Community rules identity and private Community Updates visibility. Community settings keep #rules and #moderator-only; do not switch updates to the public announcements channel. Bootstrap preserves the standard Text Channels/Voice Channels categories and general/General channels with staff-only permissions and tracks them for audit; their contents are not deleted. Other untracked channels are reported for operator review. Audit never changes permissions or deletes anything. Re-run it until every finding is understood; permission, hierarchy, administrator-bypass, missing-resource, and unrecorded-access findings require operator review.

The separate **Agent Smith Bot** console workflow runs `pnpm --filter @workspace/agent-smith run start`. It is the normal development startup path after initial setup. Feeds are a separate one-shot command, not part of the gateway process.

### Future production hosting — separate decision

Development and testing require no VM, publishing, web server, or uptime-ping
workaround. Unattended 24/7 production operation needs a continuously running
Node.js host; Reserved VM background-worker hosting is one Replit option for
this Gateway design, not a code requirement.

See [HOSTING.md](HOSTING.md) only when the owner explicitly requests production
hosting. It is a future reference, not a prerequisite or authorization to publish.
Any future web dashboard must remain a separate authenticated process; never
expose the bot token to it or a browser.

## 3. Member and reviewer workflow

- Public entry channels are #welcome, #rules, and #onboarding (read-only), plus #arrival-lounge (writable with 5-second slowmode). Framework and staff spaces remain gated.
- Member reads #rules and clicks **Accept rules** in #onboarding (or uses `/accept`), which grants the shared-hub Member role. Plain text `accept` is not a command.
- The **Choose your community** menu in #onboarding (or `/join framework:Faith|Gaming|Tech`) selects exactly one initial framework after rules acceptance. Once chosen, a member cannot use it again, even after role removal.
- Buttons/menu replies are private and use the same database locks, role safety checks, and audit path as slash commands. They only work on the tracked bot-owned onboarding message. Discord rules screening, when enabled, must be completed first.
- `/interest` toggles an interest within a framework the member already holds.
- The **Request another community** menu in #access-requests works without typing in that read-only channel. It submits the same private, human-reviewed request as `/request`. Only the tracked bot-owned message is accepted; it cannot grant roles or change the first community. Duplicate pending requests reuse the same ID. No access is granted at submission.
- To update only the existing tracked request message, preview with `pnpm --filter @workspace/agent-smith run access-requests:refresh`, then use `--apply` for the authorized edit. This does not bootstrap, change permissions, or reactivate legacy onboarding.
- Allowlisted humans use `/pending` and `/review id:… approve:true|false` in #access-review or #smith-controls. Self-approval is refused. A second human must review an owner's own request too.
- `/revoke user:… framework:…` is owner-only and removes additional framework access plus its interest roles. Primary framework changes are intentionally a manual owner operation with database reconciliation; they are not self-service.

Discord hides reviewer commands from ordinary users by default. To let an allowlisted reviewer without Manage Server see them, open Server Settings → Integrations → Agent Smith and permit that person to use `/pending` and `/review`. The runtime allowlist still decides authorization even if command visibility is widened. `/revoke` remains owner-only at runtime.

SQL transactions and per-member advisory locks serialize competing requests. Discord API calls and PostgreSQL commits cannot form one atomic transaction: if Discord succeeds and the database commit fails, the audit can flag unrecorded access. Stop onboarding, inspect the Discord audit trail and SQL audit/requests/grants tables, then remove the unexpected role or deliberately reconcile the record. Never retry blindly or grant broad Administrator as a workaround. External manual role changes are reported by audit, not automatically reversed. Run audit after staff permission changes and regularly during operation.

To update the existing tracked onboarding message with these controls, run `pnpm --filter @workspace/agent-smith run onboarding:refresh` after the bot code is updated. This edits only that bot-owned message and writes an audit record; it does not rerun bootstrap, alter permissions, replace resource IDs, or delete messages.

## 4. News, YouTube, and gaming foundations

Edit `feeds.json` with trusted public HTTPS RSS/Atom URLs and enable only the entries you want. The YouTube placeholder uses the channel ID feed format; replace `REPLACE_CHANNEL_ID`. Destinations are restricted to the three framework news channels. Feed configuration is operator-only; do not accept arbitrary member URLs.

Run `pnpm --filter @workspace/agent-smith run feeds:run` separately on a scheduled job (for example every 15 minutes). It polls once and exits, with persistent deduplication and at most five recent items per source per run. First activation may post the latest five entries. Failed feeds return a failing exit status; database audit records successful polls. The feed-status channel is reserved for future operational alerts. A crash after sending but before committing can duplicate an item on the next run; delivery is not exactly-once.

In #arcade, Gaming members use `/trivia` and `/answer`: one question per minute, one answer per session, and two-minute expiry. Correct answers earn up to 10 Gaming XP with a 10-minute earning cooldown, 30 trivia XP/day, and the shared 150 earned XP/framework/day maximum. `/profile` privately shows all of the caller's approved frameworks; `/ranks` explains the seven ladders and earning rules. Faith levels 3–7 require explicit human approval. See [PROGRESSION.md](PROGRESSION.md) for exact thresholds, contribution controls, safe migration, role reconciliation, and remaining recovery limitations. XP and cosmetic ranks never grant membership or administrative permissions.

## 5. Owner-only moderation and alerts-only anti-spam

Use `/mod` in #smith-controls or #access-review. Only `OWNER_IDS` may use it at runtime, even if Discord command visibility is widened. `APPROVER_IDS` do not gain moderation authority. Discord defaults the command to Administrator visibility; a configured owner without Administrator needs a per-command permission override in the server's Integrations settings, not a broad Administrator grant.

| Command | Behavior |
| --- | --- |
| `/mod warn user reason` | Durable warning case, with a best-effort private notification; reports failed DM delivery |
| `/mod history user` | Recent cases, including withdrawn warnings, spam alerts, action intents and results |
| `/mod unwarn case reason` | Marks an existing warning withdrawn; preserves all original history |
| `/mod timeout user minutes reason` | Timeout from 1 minute to 28 days |
| `/mod untimeout user reason` | Removes a timeout |
| `/mod kick user reason` | Removes member only after the requesting owner confirms |
| `/mod ban user reason` | Bans only after confirmation; does not delete existing messages |
| `/mod unban user_id reason` | Lifts ban only after confirmation; does not reinvite or restore roles |
| `/mod purge channel amount reason` | Previews up to 100 recent messages, then confirms deletion of that snapshot only |
| `/mod status` | Missing bot permissions, anti-spam settings, and unresolved action cases |
| `/mod antispam enabled reason` | Persistently enables/disables alerts; never enables automatic punishment |

Kick, ban, unban, and cleanup confirmations are private, bound to the initiating owner/server/channel, expire after two minutes, and are single-use. Cancel makes no change. Restarting the bot invalidates outstanding confirmations. Target hierarchy and permissions are checked again before the action. Configured owners, the actual server owner, bot accounts, and the invoking owner are protected. A non-owner configured owner must hold the necessary Discord permission and be above the target's role; the bot also needs the relevant permission and hierarchy. Administrators cannot be timed out.

Grant Agent Smith only these extra server permissions to enable the corresponding actions: **Moderate Members**, **Kick Members**, **Ban Members**, and **Manage Messages**. No Administrator permission is needed or requested. Manage Messages must also be effective in the chosen cleanup channel. Use `/mod status` to check; unavailable actions explicitly refuse rather than claiming success. The bot cannot grant itself missing Discord permissions.

Cleanup skips pinned messages and messages approaching 14 days old. It never deletes newly arrived messages outside the approved snapshot. Rules, onboarding, welcome, read-only channels, staff/audit channels, Community Updates, and preserved starter channels are protected from cleanup.

Moderation cases use the existing `audit` table; no new schema or database replacement is required. A case records intent before an external Discord action, then a result. If the result cannot be written after Discord succeeds, the bot explicitly warns not to retry. `/mod status` lists unresolved intents for manual recovery. Discord and PostgreSQL are not one atomic transaction. Warnings and their withdrawals are append-only audit events.

Anti-spam monitors message-rate and mention metadata in channels the bot can see: 6 messages in 10 seconds, 12 in 30 seconds, or 5 user mentions / @everyone. It stores no message content, needs no Message Content privileged intent, ignores bots/webhooks/configured owners, and has a 60-second per-member alert cooldown. Alerts are recorded in PostgreSQL and sent without pings to private #feed-status. When monitoring is disabled, no new observations are processed. Enable/disable state survives restarts; rolling counts reset on restart. It never deletes messages, times out, bans, or changes access automatically.

The shared Accept rules control remains for new members. Repeated acceptance keeps the original timestamp and cannot reset the one-framework choice. `/pending` labels entries **Request #1**, etc., and offers Approve/Deny buttons; `/review` uses that request number, not the member's Discord ID. Submitting a request alone never grants access.

## Validation and recovery

The tests cover framework selection, human allowlists, fixed-target refusal, write confirmations, safe role grants, category visibility, read-only onboarding, and command serialization. The offline preflight checks the full blueprint's visibility grants and confirms no Administrator grant. Role assignment refuses roles with nonzero server permissions or unsafe hierarchy. Live API and PostgreSQL acceptance checks require configuration.

The request-pipeline tests evaluate the actual `src/bot.js` interaction listener with fake Discord interactions and an in-memory database. They cover private replies, onboarding requirements, pending-request ID reuse, submission without access changes, official-message checks, human approval/denial, self-approval refusal, and requests after native cutover while legacy accept/join stays disabled. Live connection modules and background workers are replaced in a closed module graph; unexpected imports or SQL are refused. Run these through `pnpm run bot:test` or the package's `test` script, which enables Node's VM modules (an experimental warning is expected). These checks do not connect to Discord or PostgreSQL and do not prove real database concurrency or Discord delivery.

Before inviting members, use a normal test account: confirm it sees only START HERE; accept rules and confirm hub access; join one framework; verify both other frameworks remain hidden; attempt a second join; request a second framework; verify only an allowlisted human can approve and that self-approval fails; revoke it; run audit. Test trivia replay/cooldown and feed deduplication. Check a second process cannot concurrently select two frameworks for the same member. Review Discord's View Server As Role as a supplement, not a substitute for the test account.

Back up PostgreSQL before changes. In a partial bootstrap failure, keep the database and rerun the plan. If a Discord create succeeded before its resource record was saved, the name-collision guard will stop: verify the object's identity and permissions before manually recording it or deleting that newly created object. Never wipe the resource table to bypass the guard.

### Browsing a pending-request backlog

In #access-review or #smith-controls, allowlisted human reviewers use `/pending` to list 15 pending requests at a time, ordered by request number. **Next page** shows requests after the last listed number; **First page** refreshes from the start. Responses are private and do not ping members. Up to four requests on each page have Approve/Deny buttons; use `/review id:<request number> approve:true|false` for any other listed request. Use the **Request #** number, not the member's Discord ID.

Pages query the current queue on every click, not a saved snapshot. Reviewing earlier requests will not skip later ones during navigation. If a later page becomes empty, use **First page** or rerun `/pending`. Paging alone never changes requests or access, and the same staff/channel restrictions apply to every click. No command re-registration or storage migration is required for these page buttons; the running bot must load the updated code.

The isolated pending-page tests cover queues exceeding 20 requests, page boundaries, large request numbers, changing/empty queues, authorization, message/component limits, and review from later pages. They do not contact Discord or live storage.

The pinned discord.js release supports Node 22; its HTTP dependency is overridden to patched Undici 6.28.1. Recheck `npm audit` during upgrades. No secrets or production credentials are included.

References: [Discord permissions](https://docs.discord.com/developers/topics/permissions), [application commands](https://docs.discord.com/developers/interactions/application-commands), [discord.js documentation](https://discord.js.org/docs/packages/discord.js/14.25.1).
