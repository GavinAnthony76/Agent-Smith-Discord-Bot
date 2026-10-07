# Agent Smith — Reserved VM hosting

## Current Owner request

The Owner requested that Smith remain online unattended and selected preparation
for Replit Reserved VM hosting. This authorizes preparation, not spending on or
performing a publish, changing Discord permissions, or stopping the current bot
before an approved cutover.

Readiness checks on 2026-10-06: 295 offline tests passed, one existing test skipped;
permission preflight and source-boundary checks passed. The development Gateway
was running, and no active production deployment existed.

**Worker configuration approved:** the Owner approved repurposing only the unused
API artifact's production configuration for Smith. Its production build now runs
Smith's offline preflight, and its run command launches the standalone bot worker.
API source, development command, local port and preview paths remain unchanged.
The initial worker-only preparation removed the obsolete API health probe.
The Owner later approved a minimal process-status and Discord-readiness listener
because published artifact startup continued to require an HTTP response.

The global deployment target remains Reserved VM (`vm`). HTTP startup checks
are now enabled with `ignorePorts = false` through schema-validated configuration;
the worker binds its approved status listener to `PORT`. This does not
purchase a VM or publish. Review Publishing's actual Reserved VM/background-worker
selection, price, production secrets and database-copy settings before proceeding.
Changing only `.replit`'s run command is insufficient: artifact production
commands take precedence. Do not add a dashboard, private data endpoints, or a
second development Gateway. The only approved web surface is the minimal status check.

## Development does not depend on this document

Agent Smith runs directly in the development workspace through the **Agent Smith
Bot** workflow, or `pnpm run bot` from the root when that workflow is stopped.
Do not run both. No VM, website, or publishing is required for offline tests.
The running bot now includes its minimal status listener; it is not the template
API service. Template API/canvas services are independent and optional.

This document records the approved hosting preparation and cutover safeguards.
It is not authorization to create a paid Reserved VM, publish,
stop the workspace bot, move projects, or replace its database.

## Production status and later choices

The worker's production configuration is prepared, but no production deployment
was started by this configuration change. The registered artifact remains labeled
API Server for development; only its production commands now run Smith.
Recheck actual deployment status at cutover. The API server code is not the bot
launcher. The approved status listener is inside Smith's existing worker process,
not a separate API server or second bot.

Any suitable continuously running Node.js worker host can execute the same bot.
On Replit, Reserved VM background-worker hosting is an option for unattended
Gateway operation. Development uses the existing workflow instead.

## Prepared production settings — publishing still requires Owner action

| Setting | Value |
| --- | --- |
| Deployment type | Reserved VM (always running) |
| Application type | Long-running bot worker with an approved minimal status listener |
| Instances | One gateway process |
| Runtime | Node.js 24; minimum 22.12 |
| Command working directory | Repository root |
| Dependency installation | `pnpm install --frozen-lockfile` if the publishing build does not already install dependencies |
| Production build | `pnpm --filter @workspace/agent-smith run preflight` (offline, no database or Discord connection) |
| Additional readiness verification | `pnpm --filter @workspace/agent-smith run test` |
| Run command | `pnpm --filter @workspace/agent-smith run start` |
| Public ports / routes | Configured `PORT`; `/api` and `/api/healthz` are liveness, `/api/readyz` is Discord readiness |
| HTTP health endpoint | Status and readiness only; no identities, settings, private records or credentials |
| Database schema changes | Managed Publish schema review only |

The JavaScript bot needs no compilation. Do not use the root workspace build as
the bot's build, run the API server alongside it, or include `db:migrate`,
bootstrap, command registration, audits, or standalone feed polling in its startup
command. Approved feeds run inside Smith's existing Gateway; never launch a second
feed bot or Gateway.

Reserved VM has a fixed hosting charge even when Discord is quiet. Production
database usage is billed separately. Review the actual machine price in
Publishing before committing. Choose only the capacity the user approves.
An always-running server is not a guarantee against restarts or network outages.
Review publishing geography before the first publish; the choice is permanent.

## Secrets

Keep these in Replit Secrets and review their production availability in the
Publishing settings without copying values into chat, source, logs, or endpoints:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `BOOTSTRAP_CONFIRM_GUILD_ID`
- `OWNER_IDS`
- `OWNER_DISCORD_ID`
- `APPROVER_IDS`, only if already configured and intended
- Replit-managed `DATABASE_URL`

Do not manually override the managed database connection or reuse a development
connection string to avoid production setup. Never expose the token through the
API server, browser code, health responses, or a web dashboard.

## Preserve existing state before first publish

The development database already holds live Discord identities. A read-only
preparation check found 62 resource records; the other six bot tables were empty.
That is a historical observation, not a future acceptance threshold. Recheck
at cutover because the workspace may have served new interactions.

1. Identify the existing database in the Database tool without revealing
   connection details. Arrange a supported backup/recovery point.
2. Confirm Publishing can transfer **both schema and data** to managed production.
   Schema creation alone is insufficient. For legacy databases, the documented
   setting is **Set up your production database with your current development
   data**. Current infrastructure may present a different flow; if there is no
   supported data-copy path, stop and resolve it before publishing.
3. Never choose an empty production database. Preserve all bot tables, including
   resources, membership, requests/grants, audits/settings, native onboarding
   jobs/alerts/state, progression tables, delivery queues, feeds and trivia,
   including IDs, timestamps, and sequences. Do not delete records or rerun
   bootstrap as a substitute for transferring them.
4. Let Publish handle managed production schema differences. Review rename and
   destructive-change prompts. Do not add custom production DDL, migration build
   hooks, or startup-time schema creation.
5. Copy development data only for the approved initial transfer. After production
   starts taking interactions, its state is authoritative. Do not overwrite it
   with stale development data on later publishes.

## Single-instance cutover (user executes publishing)

Do not launch production previews with the real Discord token while another bot
is active. Read-only database checks and offline tests do not need a gateway.

1. Resolve the publishing eligibility blocker and review the worker settings,
   price, production secrets, and supported data-transfer path.
2. Obtain approval for the cutover window. Pause onboarding and access reviews.
3. Stop **Agent Smith Bot** in the workspace; confirm the workflow is stopped
   and no other bot gateway process or feed job is running. It reported
   `not_started` during preparation, but recheck at cutover.
4. Allow in-flight commands to finish before making the final backup/data copy.
   Record a read-only baseline: full resource identity map and all table counts,
   latest audit/request IDs, and pending requests. Keep any backup private.
5. The user reviews Publish's schema/data prompts and clicks Publish. Use only
   the bot worker, not the API server. Do not restart the workspace workflow.
6. Confirm production remains running without restart loops and has the same
   tracked resource map, member state, requests, grants, audit history, feed
   deduplication, and trivia state as the final frozen baseline. Read production
   through the Database tool or supported read-only production queries.
7. Run the existing read-only `discord:audit` against the approved production
   environment using supported production tooling, without changing secrets.
   Resolve any findings before reopening onboarding. Do not run it accidentally
   against development after production has started taking writes.
8. Confirm all fixed-target/actual-owner checks remain in force. Check the
   adopted Community rules channel identity, private moderator-only Community
   Updates channel, and tracked staff-only starter channels. Do not alter their
   identities, content, or permissions during hosting setup.
9. Test a harmless registered command from a human account and confirm exactly
   one reply. Keep the workspace gateway stopped afterward, including on future
   workspace visits. Operational changes require production-state awareness.

If production fails before taking interactions, stop it and confirm it is fully
stopped before restoring the workspace instance against its original database.
If production has taken interactions, the development database is now stale:
do not resume the workspace against it. Stop, preserve production state, and use
an approved recovery/reconciliation plan. Never run both bots simultaneously.

## Missing feed-schema recovery

The published worker was observed crash-looping on 2026-10-07 because
`feed_sources` did not exist. Read-only schema checks found both `feed_sources`
and `feed_deliveries` absent in development and managed production. The existing
`feeds:migrate` command had not been applied to development; neither the
dependency-only merge hook nor offline publishing preflight caught the omission.

The Owner approved applying the existing additive feed migration to development,
preparing a republish, and then staging the repair for application to main before
live verification. They explicitly requested “Apply the repair to the main.”
The approved development-only merge exception runs `feeds:migrate` so main gets
the task-local schema before Publish computes its production diff.
It creates the missing tables and due-source index,
without modifying member, consent, access, case, or delivery history. This is
not authorization to overwrite production data or run DDL against production.

Recovery and future releases:

1. Apply this task's changes to **main** first. Publishing while a task is still
   isolated uses main, not the task's code or development schema. The approved
   merge setup runs only `pnpm --filter @workspace/agent-smith run feeds:migrate`
   in development. Other migrations still require explicit approval.
   Never run the empty template schema push against Smith's database.
2. Run `pnpm --filter @workspace/agent-smith run feeds:schema-check`.
   This is a read-only zero-row check of required feed columns, with no Gateway
   login. Merge setup runs it after the additive migration and fails visibly if
   feed schema remains incomplete. No Gateway starts during setup.
3. Keep the workspace bot stopped. Review the development-to-production schema
   diff in Publishing, then republish the single Reserved VM worker with
   the approved status listener and HTTP startup checks enabled. Do not select
   an overwrite/copy-development-data option.
   Stop if the review proposes dropping or recreating existing state.
4. Let Publish apply managed production schema changes. No migration runs in the
   build command or bot startup. Startup checks schema read-only **before**
   connecting to Discord and fails with recovery guidance if it is incomplete.
5. Verify production has both feed tables, the log reaches “Agent Smith ready,”
   and there are no new missing-schema errors or restart loops. Check worker
   health checks too: `/api` should report process liveness, while `/api/readyz`
   must remain 503 until the Gateway and bot startup are actually ready. A
   successful liveness response is not proof that Smith is online.
6. Confirm production history is preserved and the workspace Gateway remains
   stopped. Republishing is incomplete until these live checks succeed.

The Owner approved staged completion because task isolation prevents live
verification before these changes are applied to main. This repair delivers
tested code and development setup; a separate live-recovery follow-up must
confirm successful published startup. A successful publish/build status alone
is not evidence that the bot is running.

Pre-repair production read-only counts: members 19, requests 2, grants 2,
audit 59, moderation cases/notes 0, request notifications 0, legacy feed items 0.
These are observations, not a backup or fixed acceptance thresholds; production
may legitimately gain records.

## Gateway login allowance and unattended startup

The long-running worker checks Discord's Gateway session-start allowance before
logging in. If it is exhausted, it stays running and sleeps until the reported
reset plus a small safety margin, then reads the allowance again. It does not
repeatedly identify, start a second bot, or claim to be ready while waiting.
Discord.js owns reconnect/resume after a successful connection. Invalid
credentials, unsafe configuration and unrelated errors still fail explicitly.
One-off administration commands report exhaustion instead of waiting indefinitely.

A Reserved VM must run the **published** worker independently of workspace
sessions. A successful build is not proof of a successful Gateway connection.
Republish is user-controlled, and live logs must reach `Agent Smith ready`
without subsequent crashes before reporting that Smith is online.

The previously published artifact was observed enforcing HTTP `/api` startup
checks despite the saved `ignorePorts = true` worker configuration. Waiting for
Discord's reset does not by itself resolve that publishing-layer mismatch.
The Owner subsequently approved “Add status check (recommended).” The worker
now includes this listener in the same process. It starts after the read-only
schema check, before Gateway login, allowing it to remain alive while awaiting
Discord's reset. `/api` reports liveness and `/api/readyz` returns 503 while
starting, waiting, connecting or disconnected. Only completed bot startup plus
`client.isReady()` produces readiness 200. Shutdown sets readiness false.
Responses include only `status` and `ready`; routes accept GET/HEAD only.
No member data, IDs, error details, secrets or dashboard are exposed.

Deploy this repair to the existing Reserved VM using Publish; do not start
the workspace Gateway to test it. Verify the published status endpoint and
`Agent Smith ready` logs after Discord permits login. Code changes and offline
tests do not establish live uptime before republishing.

## Official references

- [Deployment types: Reserved VM and background workers](https://docs.replit.com/features/publishing/deployment-types)
- [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
- [Projects and artifacts](https://docs.replit.com/features/projects-and-artifacts/artifacts)

No publishing, secret changes, database writes, bootstrap, or workflow changes
were performed as part of preparation.

## Read-only preparation baseline

Snapshot at `2026-10-06T23:48:21.615Z`, taken in a repeatable-read, read-only
transaction. This is a comparison baseline, **not a backup or final cutover
snapshot**; the running bot may change counts. Recheck after pausing it.

| Table | Rows |
| --- | ---: |
| audit | 59 |
| bot_settings | 0 |
| feed_items | 0 |
| grants | 2 |
| members | 8 |
| native_alerts | 11 |
| native_jobs | 6 |
| onboarding_state | 1 |
| progression_announcements | 0 |
| progression_balances | 7 |
| progression_events | 0 |
| progression_faith_reviews | 0 |
| progression_jobs | 24 |
| progression_legacy_review | 0 |
| request_notifications | 0 |
| requests | 2 |
| resources | 88 |
| trivia_sessions | 0 |

Resource identity fingerprint (SHA-256 of rows ordered by guild, kind, name):
`27e38941668838cbdddee847a9266ea1d9fe6531aef8e1726a651429a8c7eb32`.
No credentials or member-level records are included in this document.