# Hallowed Core native onboarding

Operate only on the fixed authorized guild. Never publish hosting or grant Administrator.
Preparation does not publish, PATCH or PUT native onboarding or Server Guide.
The owner edits those settings concurrently in Discord.

## Prepare and inspect

```sh
pnpm --filter @workspace/agent-smith run db:migrate
pnpm --filter @workspace/agent-smith run onboarding:native -- --apply
pnpm --filter @workspace/agent-smith run onboarding:native
pnpm --filter @workspace/agent-smith run discord:audit
```

Preparation adopts the exact existing arrival-lounge channel, preserving messages
and explicit permission overwrites, into START HERE and resource tracking. Its
public View/History/Send permissions and 5-second slowmode must already be set.
No gated channel overwrites are rewritten. Three selection roles are created
with zero guild permissions and no channel grants; a safe unique exact-name role
can be recovered after an interrupted create without replacing its ID.

The inspection output reports their IDs for the owner to map in Discord:

| Required, before-join, single-choice question | Role assigned | Channel mappings |
| --- | --- | --- |
| Faith | Selection: Faith | None |
| Gaming | Selection: Gaming | None |
| Tech | Selection: Tech | None |

Do not map **Member**, **Faith**, **Gaming**, **Tech**, or interest roles to native
answers. Do not put gated framework/shared/staff channels into native defaults
or answer mappings. Existing humans can choose a Selection role through native
Channels & Roles once published; their recorded primary does not change.

## Reconciliation and recovery

- Join/update events enqueue durable, revisioned per-member jobs. Startup scans
  all humans; a five-minute rescan recovers missed gateway events. A 15-second
  worker retries failures with bounded backoff.
- Fresh Discord state must show `pending === false` and exactly one selection.
  Bots, absent choices and unknown screening state receive no automatic access.
- The same per-member database lock used by legacy onboarding, review and revoke
  serializes reconciliation. A primary/accepted-at intent commits **before**
  adding access roles. A second locked, fresh-state pass idempotently adds only
  Member and the recorded primary, not the current answer or approved extras.
- A partial role API success followed by a database failure is safe to retry:
  the authorized primary intent is already durable. Existing XP/trivia,
  acceptance, grants, requests and resource identities are not reset.
- A pre-existing held framework matching the member's first single native
  choice may become their recorded primary without reassigning that role.
  Other unrecorded held frameworks block initialization and require human
  review; they are not silently recorded as approved extra grants.
- Multiple selections and unrecorded framework access stop all new bot grants
  and create deduplicated database alerts delivered to private access-review.
  Alerts survive restarts and delivery failures. Delivery is at least once;
  Discord nonce deduplication limits duplicate alerts after a crash.
- No access/interest roles or approved grants are removed by reconciliation.
  Existing approved extra access remains intact. Missing approved extra roles
  are not automatically restored by a selection change.
- Fresh screening and selection checks occur before each role write. Discord
  and PostgreSQL cannot share one atomic transaction; an in-flight API call can
  race a human edit. The durable primary is never changed or expanded by such an
  edit; a later ambiguous state stops subsequent writes and alerts staff.

## Server Guide draft and diagnosis

Set **three** To Dos with these explicit action types:

1. **Visit a channel:** welcome — “Read the welcome and learn where to start.”
2. **Visit a channel:** onboarding — “Learn how your first community and requests work.”
3. **Send a message:** arrival-lounge — “Introduce yourself briefly; sharing beliefs is optional.”

Visit tasks need public View Channel and Read Message History; do **not** choose
the send-message task type for the read-only welcome/onboarding channels.
The arrival send task needs public View/History/Send and should keep 5s slowmode.
Use rules as a read-only Resource. To avoid draft conflicts, initially leave
welcome and onboarding as To Do targets, rather than also converting them into
Resources; converting a Resource removes it from the channel list.

The owner must inspect task types and remove stale/deleted/gated task/resource
targets in the Discord UI. If the error remains, save the three simple tasks
with rules as the sole Resource, then add other Resources one at a time. Do not
“fix” this by opening gated channels or making rules/onboarding writable.

The bot can read native onboarding and screening settings but may receive
403/Missing Permissions for saved Server Guide settings. Unsaved UI drafts are
never visible via the bot API. “Errors: 0” is not evidence that a particular
channel has wrong permissions; use the measured channel report.

Discord's published default-mode criteria require 7 default channels, including
5 with @everyone View and Send. This design exposes four entry text channels,
only one writable. If Discord enforces those criteria, native publication is
blocked under the owner's privacy rules. Do not open framework/staff channels
or invent public channels to bypass it. Advanced mode may use different counts,
but use the actual Discord UI validation; do not promise it removes the blocker.

References:
- https://support.discord.com/hc/en-us/articles/13497665141655-Server-Guide-FAQ
- https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ
- https://docs.discord.com/developers/resources/guild

## Explicit owner-confirmed cutover (NOT run during preparation)

Read-only checks:

```sh
pnpm --filter @workspace/agent-smith run onboarding:cutover
```

Only after the owner confirms native onboarding is **published**, maps exactly
the three Selection roles with no channel mappings, and rules screening is on:

```sh
pnpm --filter @workspace/agent-smith run onboarding:cutover -- --apply --confirm-native-published
```

Prechecks require fixed target/actual owner, safe roles, public arrival,
read-only entry channels, private framework/staff/starter channels, native
defaults, and existing bot-owned entry messages. They reject concurrent native
UI/message changes rather than overwriting them.
Cutover also refuses framework access that lacks accepted-primary or recorded
human-grant backing. Preserve existing roles and resolve those discrepancies by
explicit human review; preparation never fabricates approvals or revokes access.

The mode lock drains in-flight legacy grants, then commits `legacy_enabled=false`
before external changes. Old cached commands/components now refuse access.
Only /accept and /join registrations are deleted. Only the tracked bot-owned
welcome/rules/onboarding messages are edited, preserving the rules text and
removing old components. /request and human review, moderation, interests and
trivia are retained. The bot reads the switch per invocation; no restart is needed.

If external edits fail after the committed switch, legacy stays disabled and
cutover status remains `cutting-over`. Inspect the reported blocker and rerun
the same command to complete recovery. Do not manually reset the switch or run
bootstrap/old refresh to “recover.” Refresh and registration honor the switch.
All legacy remains active when prechecks fail before the switch.

## Verification limits

Automated tests exercise screening, selection changes/ambiguity, rollback,
restart, concurrency, existing members and approved extras with a transactional
Discord/store fake. Live preparation/audits verify real settings and resource
IDs without mutating member roles. A real non-staff join/screening/native UI
journey still needs owner-assisted acceptance after publication; do not claim
that API checks or unit tests are that acceptance test.