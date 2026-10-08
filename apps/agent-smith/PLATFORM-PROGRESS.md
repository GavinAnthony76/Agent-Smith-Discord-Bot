# Platform upgrade — interim implementation status

This is **not** the final production acceptance report. The complete requested
upgrade is still in progress. No new version has been published. The Owner
completed real Discord OAuth in the preview: active encrypted sessions resolve
fresh Owner authority in both Hallowed Core and LMOC TEST. Two-guild runtime
behavior has not passed live acceptance.

Controlled live acceptance was inspected on 2026-10-08 after the Owner completed
LMOC TEST setup. The production worker is connected and ready, but the managed
production database has zero platform tables and the real platform session route
returns 404. Setup and 15 module configurations exist in development only.
Live tests were held at that prerequisite; no Gateway/runtime, Discord resources,
Hallowed Core configuration or pending adapter was changed. Exact observations
and additional release blockers are in `LIVE-ACCEPTANCE.md`.

## Built and verified

- Public website and responsive, sign-in-gated dashboard, in the existing Smith
  product. Overview, module configuration, scoped records, setup, resources,
  role flags, audit history and plan presentation use generated API clients.
- Discord OAuth authorization-code flow for `identify guilds`; browser-bound,
  expiring, single-use state; random session cookies; hashed session lookup;
  authenticated encryption of provider tokens; locked refresh; logout;
  CSRF/Origin enforcement and fresh guild-authority resolution.
- Server-scoped configuration with optimistic revisions and transactional audits.
  Fresh ownership/membership/permissions, not a submitted user/guild role, decide
  access. Owner-only dashboard-manager administration.
- Sixteen additive platform tables applied to development only. Existing guild
  tables remain the source of truth. No automatic boot/build migrations, table
  replacement, production DDL or destructive data conversion.
- Read-only, SDK-gated REST preview client. It never logs into the Gateway and
  rejects all Discord REST mutations. Production integration reuses the existing
  bot/client/listener and falls back to the unchanged core if platform startup
  cannot initialize.
- New-guild text-XP ledger and content-free activity counts; no invented historical
  metrics. Voice and retention figures explicitly remain unavailable.
- Configurable Free/Pro/Ultimate entitlements and billing/subscription models;
  no checkout, charging, billing provider or final prices activated.
- Per-server monthly paid-model request/token accounting and a request cap in the
  new platform conversation adapter, alongside the existing daily budget.

## Ticket adapter implemented; live activation not verified

Standard-server panels now have a publishing channel, ticket type and up to five
validated intake questions. Published buttons and forms bind to the actual
message, channel and record revision. Private channel creation is reserved once
in PostgreSQL, with a fixed access snapshot, a unique marker and audited SDK
intent/result. Claim, escalation and closing are wired to dashboard actions.
Closing keeps the channel private and read-only for participants, preserving its
messages for future transcript export. Full transcript-file export/storage is
not implemented.

An uncertain creation is held, not automatically retried. The Owner can reconcile
a unique live private channel without resending anything. Interrupted closing
requires review of its executor before clearing an in-flight marker: the Owner
must stop/review the executor and use CONFIRM_EXECUTOR_STOPPED as the reconciliation
note. Never use that confirmation merely because a browser request timed out.

The SDK gate permits only one exact ticket request with a durable audit intent;
it cannot grant roles, moderate members, delete channels or alter Hallowed Core.
Ticket activation in Hallowed Core still requires its separate policy review.
The read-only preview cannot publish panels or create channels.

The isolated PostgreSQL test covers concurrent opens, status transitions,
unchanged original support ACL after a panel edit, lost acknowledgement and
reconciliation without another creation. These use simulated Discord operations,
not live Gateway events. Real SDK REST encoding is also checked against a local
synthetic server, never Discord.

## Welcome and standard onboarding adapters implemented; live activation pending

Welcome supports a configured channel, bounded `{user}`, `{server}` and
`{memberCount}` placeholders, embed text, an HTTPS banner, HTTPS link buttons and
an optional onboarding button. Actual joins get durable delivery reservations;
replayed events do not automatically resend. Unconfirmed deliveries stay held.
Joining alone grants no role.

The standard-server onboarding flow supports MESSAGE, RULES_ACCEPTANCE,
ROLE_SELECT, QUESTION, BUTTON and FINALIZATION. Members can start/resume through
a published dashboard entry button or welcome button. Progress and explicit rules
acceptance are stored per guild/member/configuration revision. Configuration
changes restart consent; old acceptance is never inferred. Question answers are
transient and are not stored in SQL, audit, model context or form metadata.

Self-role selection uses a one-request audited SDK gate and fresh configuration,
membership and hierarchy checks. Only explicitly self-assignable cosmetic roles
can be added to the requesting member. Staff/security/managed/unknown permission
bits, Owner targets, bot targets and private-channel grants are refused. Role
groups, human-reviewed additional access and automatic rewards remain unfinished.
Hallowed Core's native onboarding and guarded role workflows are unchanged.

These adapters were exercised with synthetic SDK operations and isolated
PostgreSQL data, not live joins or Gateway button events. The read-only preview
cannot publish the entry message or grant a role.

Latest checks: 435 offline regression tests passed, six skipped; all nine isolated
PostgreSQL checks passed. The welcome/onboarding check exercises replayed joins,
lost send acknowledgement, entry publishing, all six step types, cosmetic role
selection, retained consent, transient questions, foreign-guild refusal and
configuration-revision reset. Website/API type checks and the website build pass.
Source security checks pass; SAST has only the previously reviewed medium session
cookie warning. No live Discord mutation, production DDL or release was performed.

## Standard commands and cosmetic economy adapters implemented; live activation pending

The shared Gateway can add missing guild-local `/smith` and `/smith-community`
commands in standard guilds. Registration uses a closed audited exact-payload
scope. Existing names and command trees are not overwritten or deleted; Hallowed
Core registration is untouched. Preview identity clients still reject writes.

`/smith-community` supports onboard, balance, daily, shop, buy and inventory.
Cosmetic wallets, cooldowns, shop purchases and inventory are guild/member scoped.
Daily claims serialize with an advisory transaction lock. The isolated test
observes a second transaction waiting, verifies only one claim, replays the saved
interaction without another credit, checks confirmed purchase price and UNIQUE
inventory, and confirms other guilds/members see no wallet data. Purchases debit
and record inventory/audit atomically. Credits have no real-money value, do not
grant roles and do not activate billing. Member progression records also expose
the recorded cosmetic balance.

These remain unpublished. Simulated registration/interaction checks do not prove
live slash-command appearance or actual Gateway operation in LMOC TEST.

## Not finished

- Live ticket flow on LMOC TEST, plus policy-reviewed
  Hallowed Core ticket activation. No new runtime version has been published.
- Live standard-guild onboarding and welcome verification, role-group and
  human-reviewed access adapters, moderation command registration/execution,
  AutoMod adapters, plus live standard command/economy acceptance.
- Achievement trigger execution and automatic reward assignment.
- Voice XP, voice-time analytics, retention calculations and analytics charts.
- Live feed publication/approval editing through the new dashboard. Existing
  Hallowed Core feed workers and recovery stay intact; new feed records are drafts.
- Full Hallowed Core configuration bindings. Text-XP/economy switches and excluded
  text channels have a guarded settings binding. Other unsupported settings are
  drafts, not a replacement of its native onboarding, access or security policy.
- Both-guild runtime acceptance. Browser-intercepted UI checks are synthetic
  and must not be described as real authentication or real Discord operation.

## Checks

The offline regression suite, generated-client/library and artifact type checks,
production frontend build, recursive security-source checks, and dedicated
development PostgreSQL integration runner have been exercised. The integration
runner creates/drops only a unique schema with no public search-path fallback:
it verifies CSRF, expiry/logout, fresh role revocation, cross-guild refusal,
encrypted token storage, audited saves and an observably blocked concurrent
transaction with one winning revision.

Browser checks cover public routes, signed-out protection and synthetic
intercepted configuration/onboarding/read-only forms. They do not prove a live
Discord callback, role mutation or installation.

Security dependency findings were patched where compatible trusted releases were
available. Remaining build-tool advisories and any reviewed static-analysis
warning must remain visible; do not report the whole project as vulnerability-free.

## Live setup verified and remaining prerequisites

The Owner registered both OAuth callbacks in the existing application's Developer
Portal. Both registrations have been checked through Discord.

The Owner authorized and installed Smith in the distinct private **LMOC TEST**
server. Read-only SDK checks confirm installation and freshly resolve its actual
server owner's dashboard authority. The Owner subsequently completed real preview
sign-in, with active encrypted sessions freshly resolving Owner authority in both
guilds. This still is not proof of unpublished runtime operation.

After the Owner's permission update, LMOC TEST has Manage Roles, Manage Channels,
Manage Messages, Kick Members and Ban Members. Moderate Members is still absent;
Administrator remains off. Timeout tests need that additional permission only in
LMOC TEST. Ticket/onboarding permissions do not require changing Hallowed Core.

Server AI phrasing preferences now reach the provider's message assembly as
bounded, additive, untrusted style data. They cannot replace the base safety
persona. The standard-server persona no longer claims to serve Hallowed Core.
Fresh-role authorization rejects cached role ghosts, and standard-server overview
XP comes from its actual platform profiles rather than Hallowed Core's legacy
progression table.

Do not publish this partial upgrade or apply its production schema until the
unfinished runtime adapters and their acceptance checks have been completed.
The final requested 36-part implementation report is due after completion, with
separate exact Hallowed Core and second-guild test instructions and real results.
