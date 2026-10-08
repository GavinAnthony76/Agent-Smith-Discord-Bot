# Agent Smith — Hallowed Core

Agent Smith is a Discord bot for the user's NEW server, Hallowed Core. It provides rules acceptance, one initial Faith/Gaming/Tech community, human-reviewed additional access, interest roles, feeds, and sample gaming trivia.

## Safety and scope

- The user confirmed the old server was deleted. Install and operate the bot only in Hallowed Core; never operate on another server.
- Both `DISCORD_GUILD_ID` and `BOOTSTRAP_CONFIRM_GUILD_ID` must equal the fixed authorized target `1556423230590423042` before any connection. `PROTECTED_GUILD_IDS` is no longer required.
- Never put bot tokens in chat, source code, client code, or a public endpoint. Use Replit Secrets.
- The user authorized seven independent progression ranks per framework, additive progression migration, creation/tracking of 21 cosmetic rank roles, command registration, and restart in Hallowed Core only. Preserve all existing access, XP, resource IDs and audit history.
- Progression is participation/service recognition, never message volume, spiritual worth, teaching/moderation authority, or access approval. Faith levels 3–7 need allowlisted human approval; no self-awards or self-approval. No Message Content Intent or AI scoring.
- Future rank-gated unlocks must use a separate framework-specific role and enforce approved membership AND rank in the bot. Never grant channel access with a global/cosmetic rank role or assume Discord role overwrites enforce an AND condition. Unlocks start disabled; do not change channel privacy without explicit approval.
- The user authorized migrations, live bootstrap preview/application, command registration, audit, and bot startup for the fixed target.
- Preserve the actual-owner allowlist and initial clean-server checks. Stop if Discord Community is not enabled; do not enable it automatically.
- Adopt only Discord's designated existing #rules channel, preserving messages while applying planned placement and read-only permissions. Preserve the private #moderator-only Community Updates channel unchanged.
- Preserve the four standard Discord starter channels/categories with staff-only visibility rather than deleting their contents; track and audit them separately from the blueprint.
- The user approved the full moderation toolkit plus anti-spam, restricted to configured owners only. Framework access reviewers do not gain moderation authority. Anti-spam starts alerts-only; automatic deletion, timeout, or bans require separate approval.
- Native onboarding migration is authorized only here. Adopt the existing public arrival-lounge channel `1556451709272719451` with 5-second slowmode; preserve its custom overwrites and all existing resource IDs and history. Never edit the owner's concurrent native onboarding/Server Guide drafts.
- Native Faith/Gaming/Tech answers map ONLY to zero-permission, no-channel-grant `Selection: Faith`, `Selection: Gaming`, `Selection: Tech` roles. They must never map Member or actual framework access roles. Wait for explicit `pending=false` and exactly one selection before reserving a first primary; changes never replace the recorded primary or add extra access. Ambiguity fails closed with durable human staff alerts.
- Optional native Gaming/Tech/Faith interest questions may assign only tracked cosmetic Interest roles without channel mappings or effective permissions. They never establish membership or rank; preserve the owner's concurrent draft.
- Preserve human-approved extras and all moderation/review/interest/trivia behavior. Keep the old accept/join buttons, menus and commands active until the owner confirms native UI publication and explicitly runs the checked cutover command. Never reopen the read-only entry channels, framework/staff gates, or publish paid hosting during this migration.

## Run & Operate

- `pnpm --filter @workspace/agent-smith run test` — unit tests, no credentials or network connection
- `pnpm --filter @workspace/agent-smith run preflight` — offline blueprint/permission checks
- `pnpm --filter @workspace/agent-smith run discord:register` — offline slash-command preview
- **Agent Smith Bot** workflow / Run button: `pnpm --filter @workspace/agent-smith run start` — independent development Gateway process; no web port, VM, API/canvas process, or publishing required. Never start a second copy with the same token.
- Root shortcuts: `pnpm run bot`, `pnpm run bootstrap`, `pnpm run register-commands`, `pnpm run bot:test`, `pnpm run bot:preflight`, and `pnpm run bot:audit`. Bootstrap defaults to live inspection; registration defaults to offline preview. Writes still require explicit `--apply`.
- Database migration, bootstrap, registration with `--apply`, live audit, and feed polling are documented in `apps/agent-smith/README.md`; they are not offline checks.
- Feeds share the existing bot Gateway. `feeds:run` refuses standalone polling; `feeds:migrate` is additive development DDL. Owner source edits disable approval; uncertain deliveries never auto-repost.
- Native inspection/preparation/cutover and Server Guide tasks are documented in `apps/agent-smith/NATIVE-ONBOARDING.md`. Cutover defaults to read-only checks; apply requires `--confirm-native-published`, an enabled native UI with correct mappings, and passing permission checks.
- Root workspace `pnpm run typecheck` and `pnpm run build` remain for the template's TypeScript packages; they do not validate this JavaScript bot.

## Stack and source

- pnpm workspace, Node.js 24; bot requires Node 22.12+
- `apps/agent-smith`: imported JavaScript ESM bot, discord.js 14, pg, rss-parser
- Bot PostgreSQL schema remains parameterized SQL in its own migration source; no ORM conversion
- `artifacts/api-server`, `artifacts/mockup-sandbox`, and `lib/*` are template packages, not the bot runtime. The bot must remain independent of the API server.
- Keep template API/canvas workflows stopped unless needed for separate web/design work; retain their files. Post-merge setup installs dependencies, applies the Owner-approved additive feed and daily-AI-budget migrations to development, and verifies feed schema read-only. It never starts a Gateway or migrates production.

## Configuration

- Mandatory security policy: `apps/agent-smith/SECURITY.md`. `OWNER_DISCORD_ID` must be a secure secret matching the actual Server Owner. Smith must remain below the Owner security role and never have Administrator.
- Server reconfiguration, channel/role deletion, role creation/reordering and bulk administration are disabled through Smith, including old operator scripts. Perform these manually as Owner. Preserve existing member data and onboarding mode.
- When implementing the expanded security checklist, retain all existing protected accounts and alerts-only automod. The Owner explicitly chose these safeguards over single-account immunity or automatic punishments. No LLM integration or paid AI usage was authorized.

Required for live operation: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `OWNER_IDS`, `OWNER_DISCORD_ID`, `DATABASE_URL`, and `BOOTSTRAP_CONFIRM_GUILD_ID`. `APPROVER_IDS` is optional. Replit currently supplies the runtime-managed `DATABASE_URL`; do not request or print it, and do not replace the database without the user's instruction.

## Architecture decisions

- Keep a dedicated console workflow for the persistent bot, without a web server or public admin endpoint. **Why:** the user explicitly requested a separate persistent process.
- Registration is preview-only by default. Every connection requires both target settings to equal the fixed Hallowed Core ID; write paths independently recheck it before login. **Why:** the old server is deleted, and the user explicitly authorized only this one server.
- Member/framework/interest role grants refuse elevated server permissions and unsafe role hierarchy. **Why:** manual permission drift must not turn a self-service role into an escalation path.
- Permission overwrites must specify Role/Member types explicitly. **Why:** a fresh Discord login may not cache configured humans, and discord.js cannot safely infer their principal types from IDs alone.
- Continuous production hosting is a later setup step, not a sleeping web preview or autoscaling request server. Read the deployment skill before configuring it.
- `apps/agent-smith/HOSTING.md` is future production guidance only, not a development prerequisite or publishing authorization. A 24/7 hosting decision requires a separate explicit request. Preserve database data as well as schema; an empty production database is unsafe.
- Do not run the template Drizzle schema push against Agent Smith's database. The bot owns its tables through explicit SQL migrations; automatic merge hooks must not change server resources or run unapproved migrations. The Owner approved additive feed and daily-AI-budget migrations in development at merge. **Why:** task-local schema must reach main before Publish can diff it; the empty template schema may propose incompatible changes. Managed production schema still changes only through Publish, never a build/startup migration.

## Pointers

- `apps/agent-smith/README.md` — complete operator setup, permission assumptions, and live acceptance checklist
- `pnpm-workspace` skill — workspace dependency and package conventions
