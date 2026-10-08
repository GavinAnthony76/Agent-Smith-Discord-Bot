# Platform upgrade — interim implementation status

This is **not** the final production acceptance report. The complete requested
upgrade is still in progress. No new version has been published, and neither real
Discord OAuth nor two-guild behavior has passed live acceptance.

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

## Not finished

- Real browser OAuth and live ticket flow on LMOC TEST, plus policy-reviewed
  Hallowed Core ticket activation. No new runtime version has been published.
- Standard-guild onboarding, role assignment/human-review adapters, moderation
  command registration/execution, AutoMod and economy adapters.
- Achievement trigger execution and automatic reward assignment.
- Voice XP, voice-time analytics, retention calculations and analytics charts.
- Live feed publication/approval editing through the new dashboard. Existing
  Hallowed Core feed workers and recovery stay intact; new feed records are drafts.
- Full Hallowed Core configuration bindings. Text-XP/economy switches and excluded
  text channels have a guarded settings binding. Other unsupported settings are
  drafts, not a replacement of its native onboarding, access or security policy.
- Live OAuth and both-guild acceptance. Browser-intercepted UI checks are synthetic
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
server owner's dashboard authority. This is not a real browser sign-in test or
proof of unpublished runtime operation.

At inspection, the test bot could view/read/send messages but lacked Manage Roles,
Manage Channels, Manage Messages, Moderate Members, Kick Members and Ban Members.
Controlled tests of the corresponding modules require only their necessary
permissions on this test server; never Administrator or changes to Hallowed Core.

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
