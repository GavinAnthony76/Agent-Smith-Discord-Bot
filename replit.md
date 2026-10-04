# Agent Smith — Hallowed Core

Agent Smith is a Discord bot for the user's NEW server, Hallowed Core. It provides rules acceptance, one initial Faith/Gaming/Tech community, human-reviewed additional access, interest roles, feeds, and sample gaming trivia.

## Safety and scope

- The user confirmed the old server was deleted. Install and operate the bot only in Hallowed Core; never operate on another server.
- Both `DISCORD_GUILD_ID` and `BOOTSTRAP_CONFIRM_GUILD_ID` must equal the fixed authorized target `1556423230590423042` before any connection. `PROTECTED_GUILD_IDS` is no longer required.
- Never put bot tokens in chat, source code, client code, or a public endpoint. Use Replit Secrets.
- The user authorized migrations, live bootstrap preview/application, command registration, audit, and bot startup for the fixed target.
- Preserve the actual-owner allowlist and initial clean-server checks. Stop if Discord Community is not enabled; do not enable it automatically.
- Adopt only Discord's designated existing #rules channel, preserving messages while applying planned placement and read-only permissions. Preserve the private #moderator-only Community Updates channel unchanged.
- Preserve the four standard Discord starter channels/categories with staff-only visibility rather than deleting their contents; track and audit them separately from the blueprint.
- The user approved the full moderation toolkit plus anti-spam, restricted to configured owners only. Framework access reviewers do not gain moderation authority. Anti-spam starts alerts-only; automatic deletion, timeout, or bans require separate approval.

## Run & Operate

- `pnpm --filter @workspace/agent-smith run test` — unit tests, no credentials or network connection
- `pnpm --filter @workspace/agent-smith run preflight` — offline blueprint/permission checks
- `pnpm --filter @workspace/agent-smith run discord:register` — offline slash-command preview
- **Agent Smith Bot** workflow: `pnpm --filter @workspace/agent-smith run start` — long-lived gateway process, no web port, kept stopped during preparation
- Database migration, bootstrap, registration with `--apply`, live audit, and feed polling are documented in `apps/agent-smith/README.md`; they are not offline checks.
- Root workspace `pnpm run typecheck` and `pnpm run build` remain for the template's TypeScript packages; they do not validate this JavaScript bot.

## Stack and source

- pnpm workspace, Node.js 24; bot requires Node 22.12+
- `apps/agent-smith`: imported JavaScript ESM bot, discord.js 14, pg, rss-parser
- Bot PostgreSQL schema remains parameterized SQL in its own migration source; no ORM conversion
- `artifacts/api-server`, `artifacts/mockup-sandbox`, and `lib/*` are template packages, not the bot runtime. The bot must remain independent of the API server.

## Configuration

Required for live operation: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `OWNER_IDS`, `DATABASE_URL`, and `BOOTSTRAP_CONFIRM_GUILD_ID`. `APPROVER_IDS` is optional. Replit currently supplies the runtime-managed `DATABASE_URL`; do not request or print it, and do not replace the database without the user's instruction.

## Architecture decisions

- Keep a dedicated console workflow for the persistent bot, without a web server or public admin endpoint. **Why:** the user explicitly requested a separate persistent process.
- Registration is preview-only by default. Every connection requires both target settings to equal the fixed Hallowed Core ID; write paths independently recheck it before login. **Why:** the old server is deleted, and the user explicitly authorized only this one server.
- Member/framework/interest role grants refuse elevated server permissions and unsafe role hierarchy. **Why:** manual permission drift must not turn a self-service role into an escalation path.
- Permission overwrites must specify Role/Member types explicitly. **Why:** a fresh Discord login may not cache configured humans, and discord.js cannot safely infer their principal types from IDs alone.
- Continuous production hosting is a later setup step, not a sleeping web preview or autoscaling request server. Read the deployment skill before configuring it.
- The user approved preparing Reserved VM background-worker hosting, not publishing or cutover. `apps/agent-smith/HOSTING.md` records the publishing eligibility blocker and safe cutover plan. Preserve existing database data as well as schema; an empty production database is unsafe.

## Pointers

- `apps/agent-smith/README.md` — complete operator setup, permission assumptions, and live acceptance checklist
- `pnpm-workspace` skill — workspace dependency and package conventions
