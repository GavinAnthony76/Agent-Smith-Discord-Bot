# Entitlement architecture

## Production boundary

The Owner has **not approved a FREE/PRO/ULTIMATE feature matrix**.
Preserve all existing production access and the existing four legacy plan
allowances. Marketing-page copy is not an authorization policy.

New registry entries have no finalized minimum plan. The development database
contains capability metadata, **not** an approved restrictive matrix and **not**
test-guild plan assignments. Billing/checkout/payment processing remain disabled.
No bot/Gateway restart, publishing, live assignment or module activation is part
of this implementation.

Legacy guild entitlement records remain intact. Separate lifecycle assignments
overlay those records for controlled testing without rewriting historical plan
allowances. The dashboard distinguishes the assigned plan from the effective
plan while access-preservation mode is active. Existing guilds without a lifecycle
overlay use their existing entitlement record, not an invented paid grant.
Hallowed Core is explicitly excluded from this new rollout and retains its
existing native authorization, configuration and role policy.

## Policy configuration

`platform_features` stores the canonical capability metadata. The source catalog
provides matching defaults when a database has no catalog data. Feature keys
cannot be invented by a request body. `platform_feature_policies` stores per-plan
availability, minimum tier and named numeric limits. Policy changes require
controlled configuration/database work, not edits throughout Discord commands.

Each restrictive rule must be explicitly approved. Enforcement additionally
requires both `PLATFORM_ENTITLEMENT_POLICY_APPROVED=true` and membership in
`PLATFORM_ENTITLEMENT_GUILD_IDS`. Neither switch is enabled by this work.
Manual assignment does not approve a rule, activate enforcement or enable a module.
Unreviewed rules preserve access; absent new limits are **not set**, not zero.
Zero disallows new usage; `-1` is unlimited. Existing feed, ticket-panel and AI
allowances continue to apply unless an approved rule overrides them.

Lifecycle states are ACTIVE, TRIAL, MANUAL, SUSPENDED and EXPIRED. Expiry is
resolved when read rather than by a destructive scheduler. Under reviewed
enforcement, an expired/suspended paid assignment resolves capability checks as
FREE. Its original assignment and earned data remain stored.

## Authorization and execution

Use the central service: `getGuildPlan`, `getGuildEntitlements`, `hasFeature`,
`requireFeature`, `getFeatureLimit`, `canUseModule`, `requireCapacity`,
`checkConfiguration` and `retentionWindow`. New worker entry points use
`runFeatureTask` plus their existing enabled/configuration/security checks.

Existing API authentication, fresh guild membership and CSRF checks are still
required before scoped details are disclosed. Entitlement availability is then
checked before an operation is configured/executed. Member permissions,
screening, qualification, protected roles, hierarchy and the one-use guarded
Discord write pipeline remain independent requirements. A plan never grants
Administrator, Owner, Moderator, protected bot roles or private channel access.

Adapters are present at API module/setup/record writes, conversational AI,
XP collection, analytics collection, economy/shop operations, cosmetic role
assignment, onboarding/welcome delivery and ticket publication/creation.
Ticket closing/reconciliation and historical evidence remain usable.
Role removal is member-requested cleanup, never an automatic downgrade action.
Unsupported feature adapters remain unsupported and are not activated by a plan.
Existing native Hallowed Core feed/reconciliation/scheduled adapters are preserved;
new multi-server adapters must use the same service before they can be completed.

Configuration, resource creation, XP quota checks and manual plan changes share
the guild row lock. Capacity checks happen within the write transaction.
Configured active-module capacity applies to individual saves and aggregate setup,
with no final maximum seeded.
AI reservations retain the existing atomic per-guild monthly UPSERT and persist
input/output tokens, missing usage and latency independently of billing.
Conversational exhaustion does not stop non-AI modules.

## Non-destructive lifecycle and retention

Assignments never enable modules or alter Discord roles/channels. Downgrades
deny new use of reviewed unavailable features and report over-limit configuration;
they never remove XP, inventory, achievements, history or configuration.
The default reward policy is PRESERVE_EARNED + DISABLE_NEW_GRANTS.
There is no automatic resource trimming or role-stripping job.

Analytics/ticket retention limits are configurable **visibility windows**, not
delete instructions. Ticket evidence and reconciliation records are preserved.
No final duration is seeded. Unsupported future feed selection/automation
requires a separately approved activity-selection policy; this work does not
invent which existing production feeds/channels should be disabled.

## Manual development administration

The existing application-owner `OWNER_IDS` configuration is the controlled
platform-admin authority. Discord guild-owner/manager status alone is insufficient.
An administrator must also have fresh settings-write authority in an explicitly
allowlisted **local development** guild. Production assignments and Hallowed Core
assignments are refused. Client-supplied source/identity/metadata/guild override
fields are refused. Source is fixed to MANUAL_TEST.

PUT `/api/platform/guilds/:guildId/entitlements` uses optimistic revision,
transactional audit and the shared guild lock. GET supplies the truthful plan,
status, billing-disabled state, supported/locked/enabled/disabled/limit states,
dependencies, measured usage, reset time and over-limit information.
The dashboard includes confirmation, optional expiry, required reason, live
refresh, stale-revision handling and read-only administrator-boundary messaging.
No fake checkout or upgrade action exists.

## Feature completion contract

Every future feature must document, before completion:

- FEATURE KEY — registered canonical key
- MINIMUM PLAN — approved configuration, or explicitly unfinalized
- LIMITS — named keys, counts/reservation semantics and reset/retention rules
- DEPENDENCIES — available and correctly enabled parents
- ROLE PRIVILEGES — existing safety/qualification gates; no plan-based bypass
- CHANNEL PRIVILEGES — visibility/privacy/guarded-write boundaries
- BACKGROUND WORKERS — every scheduled/reconciliation/delivery entry point
- DATABASE RECORDS — configuration, earned state, usage and audit ownership
- DOWNGRADE BEHAVIOR — preserve earned data; explicitly govern new usage

The central source registry supplies all nine fields for the current catalog.
Metadata for a future capability is not evidence that its adapter is implemented.

## Verification

Offline regression command: `pnpm --filter @workspace/agent-smith run test`.
Explicit isolated PostgreSQL acceptance:
`node --test apps/agent-smith/test/entitlement-isolated.integration.js`.
The latter refuses production and creates/drops a unique schema whose search
path excludes public. It uses synthetic OAuth, Discord authority and AI responses.
All restrictive tier rules are fixture-only.

Checks cover FREE/PRO/ULTIMATE resolution, approved/unapproved policy boundaries,
dependencies, expiry, zero/unlimited/reached limits, role/channel capacity,
worker/role/channel/economy/AI denial, API bypass attempts, CSRF and non-admin
assignment refusals, atomic audit/revisions, preserved upgrade/downgrade state,
AI usage and real PostgreSQL lock overlap for monthly XP capacity.
These are **not live two-guild acceptance** and do not remove existing release
blockers. Production schema changes use the managed Publish review, never startup
DDL or a custom production migration; development catalog data is not assumed to
be copied into production by schema publication.
