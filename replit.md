# Agent Smith — Hallowed Core

Agent Smith is a Discord bot for the user's NEW server, Hallowed Core. It provides rules acceptance, one initial Faith/Gaming/Tech community, human-reviewed additional access, interest roles, feeds, and sample gaming trivia.

## Safety and scope

- Do not modify the user's old Discord server. Install and operate the new bot only in Hallowed Core.
- Before live writes, `DISCORD_GUILD_ID` and `BOOTSTRAP_CONFIRM_GUILD_ID` must identify Hallowed Core, and `PROTECTED_GUILD_IDS` must list the old server ID(s).
- Never put bot tokens in chat, source code, client code, or a public endpoint. Use Replit Secrets.
- The preparation phase is offline: no Discord connection, database migration, bootstrap application, or member invitations.
- Do not start the bot or run live setup commands until the user is ready for the connection phase.

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

Required for live operation: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `OWNER_IDS`, `DATABASE_URL`, `BOOTSTRAP_CONFIRM_GUILD_ID`, and `PROTECTED_GUILD_IDS`. `APPROVER_IDS` is optional. Replit currently supplies the runtime-managed `DATABASE_URL`; do not request or print it, and do not replace the database without the user's instruction.

## Architecture decisions

- Keep a dedicated console workflow for the persistent bot, without a web server or public admin endpoint. **Why:** the user explicitly requested a separate persistent process.
- Registration is preview-only by default. Every Discord write path requires target confirmation and an old-server denylist before login. **Why:** setup must not accidentally change the old server.
- Member/framework/interest role grants refuse elevated server permissions and unsafe role hierarchy. **Why:** manual permission drift must not turn a self-service role into an escalation path.
- Continuous production hosting is a later setup step, not a sleeping web preview or autoscaling request server. Read the deployment skill before configuring it.

## Pointers

- `apps/agent-smith/README.md` — complete operator setup, permission assumptions, and live acceptance checklist
- `pnpm-workspace` skill — workspace dependency and package conventions
