# Agent Smith security policy

This policy is mandatory, not a permission-granting recommendation.

## Startup and Owner immunity

`OWNER_DISCORD_ID` must be stored in Replit Secrets. It must match Discord's
actual guild owner, who must also be in the existing `OWNER_IDS` allowlist.
Missing or mismatched configuration blocks write-enabled connections. Read-only
audits remain available and mark this configuration **UNSAFE**.

Smith refuses to start with Administrator, Manage Server, or Manage Webhooks.
The Owner must have a security role above Smith. Correct the hierarchy manually:
Server Owner → Agent Smith → administrators → moderators → framework leads →
members. The Owner role does not need Administrator: the actual guild owner
already has native ownership rights. Smith never edits or assigns this role.

The actual Owner, secure Owner ID, and existing protected owner accounts cannot
be warned, timed out, kicked, banned, unbanned, renamed, assigned/removed roles,
or have framework access managed by Smith. Native reconciliation skips the
Owner before reserving a primary community. Progression skips Owner rank/access
reconciliation. Historical records and existing access are preserved.

## Application-level mutation policy

Write-enabled SDK connections install a fail-closed REST gate shared by the
bot, workers, recovery and operator scripts. Guild management APIs not explicitly
recognized are denied. This includes server deletion/ownership transfer,
permission architecture edits, native onboarding/Guide updates, channel/role
creation or deletion, role reordering, bot self-management, member role
replacement and bulk bans. There is no Administrator-granting workflow.

Owner/Smith/admin security roles, core framework roles, entry/staff/audit
channels, and framework permission categories are protected. All channel and
role deletions are disabled, a stricter limit than permitting one.

Role grants/removals require a trusted static workflow, an exact subject,
a database-tracked allowlisted role, zero guild permission bits, an editable
unmanaged role, and a position strictly below Smith. Owner and bot subjects
are rejected. Native/rank workers preserve existing human-approved access
rules; they cannot turn model text into role-management authority.

There is currently no authenticated channel-management command. Owner-approved
bulk configuration changes must therefore be performed manually outside Smith.
Old bootstrap, role provisioning and native preparation scripts are
**not exempt** from this policy: their server-reconfiguration writes are denied.
Read-only previews and ordinary messages/forum posts remain available.
This change does not publish native onboarding or switch the onboarding mode.
The existing checked cutover remains a separate, explicit Owner console action;
it changes bot messages/command registration and internal mode only, not guild
permission architecture. Its prior publication and safety checks still apply.

## Interactive moderation

Only authenticated, allowlisted human owners may use the existing moderation
commands in the control/review channels. Discord permissions, target hierarchy,
Owner immunity and protected channels are checked again at execution.
Kick, ban, unban and purge require a single-use confirmation bound to the
requesting user, guild and channel. The exact target/message list is retained.

- Channel deletions: **0**.
- Role deletions: **0**.
- Ban targets per interaction: **1**.
- Purge ceiling: **50**, configurable using `SMITH_MAX_PURGE` from 1 to 100.
- Kick/ban/unban/purge: one reservation per operation per guild per **60 seconds**.

Cooldown reservations use the existing database audit table and a PostgreSQL
transaction/advisory lock. They survive restarts and consume the cooldown even
if a later action fails or its delivery is uncertain. Intent is saved before
Discord mutation; results are saved afterward. Do not blindly retry an
unresolved intent. Purge excludes protected Owner messages, pinned/old messages,
and messages outside the approved list.

## AI boundary and native Discord limitation

There is no AI access-control or moderation dispatcher. Unknown/AI mutation
origins have no privileged scope. Future AI features must return recommendations
only and must never receive the Discord client, mutation capabilities, or an
execution/evaluation interface. A recommendation is not a command or approval.

These are application protections, not a token sandbox. Discord's native
Manage Roles can affect lower roles—including lower administrative roles—if
credentials are used outside Smith. Manage Channels likewise retains native
channel powers. Protect the token and remove unnecessary native permissions
manually. Do not claim these guards neutralize stolen credentials.

## Verification

`pnpm run bot:test` runs offline pipeline/policy/REST-gate tests.
`pnpm run bot:preflight` checks command and permission definitions offline.
`pnpm run bot:audit` (or `npm run discord:audit` in this package) performs the
live read-only audit, including Owner identity, hierarchy, unsafe native powers,
role grant boundaries, protected resources, destructive limits, command
registration and the absence of AI privileged authority.

The audit distinguishes application enforcement from native Discord power,
prints **UNSAFE** failures, and exits nonzero for unsafe configurations.
Never restart the bot until Owner identity and hierarchy checks pass.
