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

## Not finished

- Private ticket execution/publishing/transcripts. Ticket definitions and schema
  exist, but are not a working member ticket journey.
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

## Owner setup needed for live verification

In the **existing** Discord application's Developer Portal, open **OAuth2 →
General → Redirects**, add both callback URLs supplied in chat, and save. Neither
was registered when inspected. No new application or new secret is needed.

Provide the ID of a private, authorized second test guild. Enable Discord
Developer Mode, right-click the server and choose **Copy Server ID**. Do not
install into unrelated public communities during this phase.

Do not publish this partial upgrade or apply its production schema until the
unfinished runtime adapters and their acceptance checks have been completed.
The final requested 36-part implementation report is due after completion, with
separate exact Hallowed Core and second-guild test instructions and real results.
