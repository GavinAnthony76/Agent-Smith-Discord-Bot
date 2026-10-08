# Agent Smith platform architecture audit

## Existing architecture

- Node.js JavaScript ESM, discord.js 14, PostgreSQL through `pg` and parameterized SQL. The bot does not use the template Drizzle schema as its source of truth.
- One persistent Gateway client. The published API artifact launches the existing bot worker on a Reserved VM; its HTTP listener reports liveness and Discord readiness. Development must not start another Gateway while production is running.
- Discord slash commands, buttons, member/message events and independent recovery workers are assembled in `src/bot.js`.
- Existing guarded services cover native/legacy onboarding, human-reviewed framework access, moderation/cases/reports, alerts-only anti-spam, progression, cosmetic economy, rewards, feeds and conversation.
- Actual Hallowed Core behavior includes Faith/Gaming/Tech, one self-selected primary framework, human approval for additional frameworks and protected security roles/accounts. Native onboarding and its historical-consent boundaries must remain intact.
- The conversation service has temporary user/channel history, immutable safety instructions, permission-filtered context, fresh authorization before delivery, daily paid-AI budgeting and opt-in operational lookup warnings.
- A separate achievement-trigger ledger and ticket system are not existing capabilities. Cosmetic inventory and progression ranks must not be represented as a complete achievements engine.
- There is no production administration frontend. Template API, design sandbox and promotional film artifacts are not an existing dashboard.
- Existing bot data includes guild-scoped member/grant/resource/audit records, progression, moderation/maintenance, cosmetic economy, feeds and AI budget records. Additive platform tables can reference these without copying or deleting them.
- Current tests are offline Node tests, permission preflight and static privileged-transport/AI boundary checks; some PostgreSQL concurrency tests require explicit isolated test configuration.

## Single-server assumptions to address

1. `config.js` fixes the authorized Hallowed Core target and bootstrap confirmation.
2. `discord.js` fetches one guild, validates its Owner and installs one guild's security gate.
3. `security-gate.js` rejects foreign-guild/channel writes and restricts sensitive operations.
4. `db.js` convenience operations use the fixed configured guild.
5. Blueprint/framework/security resources and protected accounts are Hallowed Core policy.
6. `bot.js` constructs guild-specific handlers and workers once.
7. Command registration and conversation channel/settings configuration use the one guild.
8. Some activity types are not currently collected; analytics must mark unavailable data rather than invent numbers.

## Migration boundary

Preserve these restrictions for the Hallowed Core adapter. Do not simply remove
the target check or grant Administrator to make new guilds work. A tenant registry,
authenticated membership/authority resolver, module registry, entitlement service
and per-guild runtime must precede new-guild dispatch. Web UI is not a separate
permission system for Discord mutations.

Existing guild-keyed data stays in place. New schema is additive; no destructive
renames, production DDL, startup migrations or template Drizzle push. Development
schema changes are separate from Publish's production schema review.

## Initial implementation boundary

Platform schema, explicit tenant authorization contracts, module configuration
validation and centralized plan limits are introduced without enabling dashboard
traffic or changing the live Gateway. OAuth and dashboard work require the existing
application's client secret; no second Discord application is needed.

Multi-server support is **not complete** until the existing guild and a separately
authorized test guild both pass installation, isolation and permission tests.
