# Agent Smith — future 24/7 production hosting reference

## Development does not depend on this document

Agent Smith runs directly in the development workspace through the **Agent Smith
Bot** workflow, or `pnpm run bot` from the root when that workflow is stopped.
Do not run both. No VM, HTTP server, website, or publishing is required to build
and test it. Template API/canvas services are independent and optional.

This document is a reference for a later, explicitly requested production
hosting decision. It is not authorization to create a Reserved VM, publish,
stop the workspace bot, move projects, or replace its database.

## Production status and later choices

No bot production deployment has been configured. The existing registered
artifacts describe a template API and design preview, not the Gateway worker.
Recheck the supported worker publishing path and actual deployment status when
the owner asks for 24/7 hosting. Do not turn the API into a bot launcher, add a
dummy web server, or move projects merely to keep developing.

Any suitable continuously running Node.js worker host can execute the same bot.
On Replit, Reserved VM background-worker hosting is an option for unattended
Gateway operation. Development uses the existing workflow instead.

## Candidate production settings — only after explicit approval

| Setting | Value |
| --- | --- |
| Deployment type | Reserved VM (always running) |
| Application type | Background worker, not web server |
| Instances | One gateway process |
| Runtime | Node.js 24; minimum 22.12 |
| Command working directory | Repository root |
| Dependency installation | `pnpm install --frozen-lockfile` if the publishing build does not already install dependencies |
| Offline verification | `pnpm --filter @workspace/agent-smith run test && pnpm --filter @workspace/agent-smith run preflight` |
| Run command | `pnpm --filter @workspace/agent-smith run start` |
| Public ports / routes | None for the bot |
| HTTP health endpoint | None; this is a non-HTTP worker |
| Database schema changes | Managed Publish schema review only |

The JavaScript bot needs no compilation. Do not use the root workspace build as
the bot's build, run the API server alongside it, or include `db:migrate`,
bootstrap, command registration, audits, or feed polling in its startup command.
Feeds remain a separately approved scheduled job.

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
3. Never choose an empty production database. Preserve all records in `resources`,
   `members`, `requests`, `grants`, `audit`, `feed_items`, and `trivia_sessions`,
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

## Official references

- [Deployment types: Reserved VM and background workers](https://docs.replit.com/features/publishing/deployment-types)
- [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production)
- [Projects and artifacts](https://docs.replit.com/features/projects-and-artifacts/artifacts)

No publishing, secret changes, database writes, bootstrap, or workflow changes
were performed as part of preparation.