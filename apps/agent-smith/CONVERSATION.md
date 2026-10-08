# Agent Smith conversational layer

## Activation and current verification

The existing bot, fixed guild, hosting launcher, Gateway, database and health
routes are preserved. No second bot or API server is introduced. The Owner
approved an additive daily-budget migration; no Discord role/permission changes
run as part of this upgrade.

The selected provider is **OpenAI through Replit AI Integrations**; no personal
OpenAI key is required. Usage is billed to Replit credits. A real, minimal request
to `gpt-5.4-mini` succeeded during verification, without sending member data.

**Ready for republish:** after the Owner enabled and saved Message Content Intent,
a read-only application check confirmed authorization. The configured chat channel
was also verified as a text channel in the authorized guild. Shared
`SMITH_ENABLE_MESSAGE_CONTENT=true` is now set. No test Gateway was opened.

1. In the Discord Developer Portal, select Agent Smith → **Bot** →
   **Privileged Gateway Intents**, enable **Message Content Intent**, and save.
2. Confirm that change before setting `SMITH_ENABLE_MESSAGE_CONTENT=true`.
   Never enable the SDK intent while the application's authorization is absent.
3. Publish the upgrade to the existing Reserved VM. Keep the workspace Gateway
   stopped; production is the only bot instance.
4. At startup, Smith upserts the static `/smith` and `/smith-control` definitions using its
   existing authenticated client. The original `/smith status` operational
   handler and its staff permissions remain intact; conversation status is
   appended privately. `/smith-control` retains all existing controls and adds
   the opt-in lookup warning setting. Other commands are not replaced.

Without that intent, slash questions and messages containing a direct
bot mention remain usable; unmentioned dedicated-channel content and some
unmentioned replies cannot be read. This is not an AI outage.

## 1. Files changed

New modules in `src/`:
- `conversation-settings.js` — bounded environment configuration.
- `conversation-context.js` — read-only, permission-filtered server/member DTO.
- `conversation-commands.js` — static `/smith` command and single-command upsert.
- `conversation-handler.js` — routing, replies, typing, authorization recheck,
  user-bound controls and explicitly requested threads.
- `ai-personality.js` — identity, faith distinctions and security instructions.
- `ai-provider.js` — OpenAI integration transport, timeout and credential isolation.
- `ai-safety.js` — local refusals, credential detection and Discord output limits.
- `ai-conversation.js` — local answers, model service, metrics, rate limits and
  ephemeral user/channel sessions.

Updated:
- `src/bot.js` — attach conversation handlers to the existing client and shutdown.
- `src/maintenance-commands.js` — extend the existing `/smith`, avoiding duplicate
  command definitions and preserving operational status.
- `src/security-gate.js` — narrowly allow only the exact static Smith-command POST
  in the already authorized application/guild. Other unknown command writes remain blocked.
- `test/helpers/bot-fixture.js` — keep access tests isolated from listeners/AI.
- `.replit` — shared non-secret conversation settings only; deployment unchanged.

New test files: `test/conversation.test.js`, `test/conversation-context.test.js`,
`test/conversation-gate.test.js`.

## 2. Architecture

Existing Discord events → trigger validation → rate limiting → read-only context
adapter → pure conversation service → local response or AI provider → fresh
authorization check → bounded Discord reply.

The model receives selected plain data, not clients, pools, credentials, callbacks,
tools or administrator capabilities. No LLM call lives directly in `messageCreate`.
Core maintenance/moderation/progression handlers remain independent of AI failures.

## 3–4. Triggers and configured channel

- Direct `<@Agent Smith>` mention.
- Reply to a message authored by Smith; parent message content is not copied into
  the model, avoiding cross-user or privileged-message context leakage.
- Dedicated channel ID: **1556423231232024689**. Once Message Content is enabled,
  Smith responds to eligible human messages there without requiring a mention.
- Threads under that dedicated channel also support plain conversation.
- Optional comma-separated `AGENT_SMITH_TRIGGERS`; none configured by default.
- `/smith ask`, `/smith help`, `/smith about`, `/smith status`, `/smith clear-context`.
- `/smith budget` — private Owner-only daily allowance status and settings.


## Daily paid-AI allowance

The Owner explicitly selected **100 paid requests and 10,000 total tokens per
day**, resetting at **midnight America/Chicago**, including daylight saving.
These are request/token limits, not a dollar estimate or a provider price.
The lower limit wins; 100 requests is not a promise that 10,000 tokens can cover
100 answers.

`/smith budget` shows measured provider tokens separately from conservative
unmeasured reservations. To edit, the configured human Server Owner must supply
all three options, for example:

`/smith budget requests:100 tokens:10000 timezone:America/Chicago`

The bot re-fetches the guild Owner and requires both configured Owner identities.
Settings edits are audited, private, and preserve already charged usage. Zero
requests or zero tokens pauses paid AI only. A timezone edit takes effect when
the existing window ends; it cannot create a fresh allowance immediately.
Lowering a limit below usage does not undo past charges; it prevents new calls.
There is no member punishment, credential change or account disabling.

Before transport, PostgreSQL serializes check-and-reserve operations across
processes for this guild. A committed reservation consumes one request and
UTF-8 bytes of all model input plus conservative message-framing margin and the
entire configured completion ceiling, including reasoning tokens. This is a
conservative estimate, not measured tokenizer usage. Large server context or
history may not fit even when some allowance remains; rejected calls cost
nothing. Smaller questions may still fit. No allowance is bypassed for Owners.

Valid provider `prompt_tokens`, `completion_tokens` and `total_tokens` replace
the reservation with measured total usage, even for empty/cancelled completions.
Cached input remains included; no provider price is inferred. Without valid
usage, or after timeout, uncertain delivery, restart or lost database commit
acknowledgement, the full reservation remains charged. Settlement is idempotent
and stays in the original window even when it completes after midnight.
If provider accounting unexpectedly exceeds the conservative reservation, the
actual amount is recorded and further calls in that window are blocked. The
allowance is an admission/accounting guard, not a provider-enforced billing cap.

Missing schema/database outages fail closed for paid AI; there is no in-memory
fallback or retry of an uncertain paid request. Greetings, local help, `/smith
help`, operational `/smith status`, access/onboarding, moderation and XP remain
independent and operational. No prompt, reply or member profile is persisted
in the budget tables.

Apply the approved additive schema to **development only** with
`pnpm --filter @workspace/agent-smith run conversation:budget:migrate`.
The post-merge setup applies it alongside the previously approved feed schema.
Do not put migrations in bot startup or the deployment build; production DDL
is applied only through the existing user-controlled Publishing schema flow.
Default selected limits are inserted on the first budget operation if no
settings row exists; subsequent starts never overwrite Owner edits.

Offline checks: `node --test test/conversation-budget.test.js` from the bot
directory. Optional isolated development PostgreSQL checks:
`SMITH_PG_TESTS=1 node --test test/conversation-budget-postgres.test.js`.
These use a disposable schema without public search-path fallback.

Ordinary channels otherwise remain quiet. Bots, self messages, webhooks, DMs and
empty messages are ignored. Duplicate Gateway message deliveries are deduplicated.
`/smith ask` is ephemeral by default; `private:false` explicitly requests a public
answer. The model never reads arbitrary channel history.

## 5–6. Provider and environment

Provisioned securely by Replit:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

Configured shared non-secret settings:

| Variable | Value |
| --- | --- |
| `AI_ENABLED` | `true` |
| `AI_MODEL` | `gpt-5.4-mini` |
| `AI_MAX_RESPONSE_TOKENS` | `2048` (includes reasoning tokens) |
| `AI_TEMPERATURE` | `1` |
| `AI_CONTEXT_TTL_MINUTES` | `20` |
| `AI_COOLDOWN_SECONDS` | `5` |
| `AGENT_SMITH_CHAT_CHANNEL_IDS` | `1556423231232024689` |
| `AGENT_SMITH_TRIGGERS` | unset |
| `SMITH_ENABLE_MESSAGE_CONTENT` | `true`; Discord authorization verified |

GPT-5/6 and o-series reasoning models use their model-default temperature rather
than sending an unsupported temperature parameter. Supported non-reasoning models
receive `AI_TEMPERATURE`. GPT-5 requests use low reasoning effort. Transport has a
25-second deadline, no automatic paid retry, and no silent model substitution.

## 7. Member context

The caller only: display name, recorded primary framework, approved framework
memberships, actual current roles, selected/configured interests, approved-framework
XP/levels/ranks and cosmetic badges from their own inventory. Queries are scoped
to the fixed guild and caller. Retained XP or an unreviewed role does not invent
framework approval.

There is no separate achievement ledger in the existing app. Smith says so rather
than generating achievements; existing progression ranks and inventory badges are
available. No warning/case/disciplinary history enters the conversational DTO.

## 8. Server context

Actual permitted channel names, topics, forum tags, types and IDs; configured
frameworks; visible scheduled-event metadata; actual rules-channel identity;
configured cosmetic shop rewards and existing access/interest/profile commands.
No hidden framework directions, message-history dump or moderation evidence.
Owner/Admin channel metadata follows existing permissions, not a claim made in chat.
Rules/resources are linked when available, never invented. Generated faith answers
are not official church doctrine.

## 9. Security

- Model has no server-action tools and never performs privileged operations.
- Ban/role/access requests and credential/injection requests receive local refusals.
- Explicit moderation/access commands retain human authentication, static
  permission checks, hierarchy/protected-resource checks, confirmations and audit.
- Channel visibility uses the central permission resolver plus recorded framework
  access. Private threads additionally require membership or Manage Threads.
- Role/visibility changes invalidate prior conversational history. Authorization
  is checked again before sending a generated reply.
- Unknown channel mentions, mass pings, user/role mentions and credential-shaped
  outputs are removed or refused. Replies suppress all mentions.
- Thread controls expire, are bound to the caller/source message/channel, verify
  current permissions, and cannot create duplicate threads through repeated clicks.
- No full prompts, member names, API payloads or provider error bodies are logged.

## 10. Rate limits and observability

Normal users: 5-second cooldown. Configured actual Owner: 2 seconds.
Global ceiling: 60 accepted requests/minute; maximum 3 concurrent model requests,
with no concurrent model requests for the same user. Repeated cooldown notices
are suppressed for 30 seconds. Inputs are capped at 2,000 characters; model tokens,
session counts and response length are bounded.

Track accepted conversation requests, AI requests, greetings, model errors,
rate-limit events, latency and last-request availability. Logs contain metadata only.
The Owner's private conversational status includes aggregate counts. No scheduled
conversation starters or unsolicited daily messages are enabled.


### Lookup budgets and safe shared reads

Content-free lookup metrics are available to the actual Owner in the existing
private status response: attempted reads, failures and cumulative latency by
fixed operation type; coalesced reads, public-cache hits, admission refusals,
timeouts, invalidations and REST backoffs. No user/channel/guild identifiers,
SQL, prompts, names, error bodies or generated content enter those metrics.

### Opt-in private Owner lookup warnings

Warnings are **off by default**. In the existing private `#smith-controls`,
the configured human Server Owner may explicitly run:

`/smith-control lookup-warnings enabled:true threshold:5 cooldown:60`

Disable with `/smith-control lookup-warnings enabled:false`. The enabled option
is mandatory; omitted threshold/cooldown options use the defaults of five
failures and 60 minutes. Thresholds are restricted to 5–100; cooldowns to
15–1,440 minutes. Settings are persisted and audited in existing `bot_settings`
and `audit` tables; no migration is needed. No settings are enabled by installing
or publishing this change.

Every minute, a separate operational monitor aggregates **lookup timeouts** and
**conversation lookups refused or aborted because of REST backoff/headroom**.
Five-minute rolling buckets contain only these two fixed-label counters.
SDK rate-limit events that do not stop a conversation lookup, ordinary
concurrency/start-budget refusals and provider/paid-AI errors do not trigger this
warning. This monitor does not tune reply capacity or change lookup deadlines.
At most six minute buckets exist; stale buckets expire. A polling gap over two
minutes discards unsampled failures rather than reporting old incidents.
Enabling, changing settings or restarting starts a new observation baseline;
historical counters do not immediately trigger a warning.

Once the combined threshold is reached, Smith attempts **one private DM to the
configured, current Server Owner**, never a staff/community channel or another
allowlisted account. Consent is bound to the Owner who saved it. Current Owner
identity and enabled consent are rechecked before delivery and at both DM REST
writes through the existing security gate. Owner changes, missing consent,
database/read failures, stopping the monitor or disabling during delivery
preparation suppress the warning. There is no fallback destination.

The fixed warning contains only timeout and backoff-refusal counts, an
explanation that generated replies were safely suppressed, and directions to
private `/smith status` and the explicit warning control. It contains no
prompts, member/channel/guild identifiers, SQL, provider payloads, private
answers, embeddings, attachments or mentions. The configured Owner's private
status also shows last-checked enablement and fixed-label attempt/success/failure
counts. Failed checks and failed/uncertain sends do not expose error bodies.

Cooldown is reserved atomically in PostgreSQL **before attempting delivery**.
It survives bot restarts and competing processes; disabled/enabled toggles and
settings edits do not reset an existing cooldown. Failed or uncertain sends
consume it too, with no automatic retry queue. Further warnings require fresh
failures after the cooldown, not just an old threshold crossing. If DMs are
blocked, inspect the failure count in private status. A DM already submitted to
Discord cannot be recalled by subsequently disabling the setting.

These are operational lookup warnings, **not daily paid-AI allowance notices**.
They do not call the AI provider, generate community conversation, change roles,
grant access, retry paid answers, punish members or bypass authorization.
The existing bot remains the only Gateway; publishing/activation is Owner-controlled.

Offline tests: `node --test test/lookup-warnings.test.js`.
Optional disposable **development-only** PostgreSQL checks:
`SMITH_PG_TESTS=1 node --test test/lookup-warnings-postgres.test.js`.
They verify persistent cooldown, actually overlapping reservations, lost
acknowledgements and audited opt-in/out without writing to live settings.

### Shared read behavior

Before changing reuse behavior, an offline instrumented baseline for three
answers (six context builds) measured six member, six role-list, six channel-list,
six event reads and 42 database queries. Fixture latency was approximately zero
for Discord operations and 2 ms cumulatively for database operations; **these
are offline measurements, not production Discord latency**.

Only the public cosmetic shop titles/prices have a TTL cache: one guild-local
entry, 15 seconds (hard ceiling 30 seconds), at most 100 rewards, titles at most
100 characters, with defensive copies. No resource mappings, member records,
grants, XP, inventories, onboarding mode, permissions or thread membership are
cached. Public rewards are advisory and never authorize access.

Role/channel/event lists and public-reward cache misses can be batched for
callers requesting them **before dispatch in the same event-loop turn**. Once
the request starts, new callers must start their own fresh request. Neither
completed permission snapshots nor already-running snapshots are reused by
later callers. Channel-scoped events are filtered against each caller's fresh,
approved visible-channel set. Events have no TTL cache.

The offline overlapping sample (two simultaneous builds, then a third) reduces
role/channel/event reads from three each to two each and public-shop queries
from three to one. Member, bot-member and per-user approval reads remain
independent. Fresh bot-member reads were added deliberately, so before/after
total REST counts must account for that safety improvement rather than claim
all authorization work was eliminated.

Each context build has a five-second deadline; at most two are active and at
most 60 may start per minute (each answer needs two). Excess work is refused
immediately, never placed in a conversation queue. Timed-out underlying SDK/DB
operations retain their admission slot until they settle; late completions
cannot continue into model generation or delivery. These operations cannot be
canceled through Discord's manager APIs. The conversation budget neither
wraps nor serializes core audit/moderation/onboarding reads. New conversation
work yields when the SDK knows a route bucket is exhausted, the global bucket
has fewer than ten requests left, or a REST rate-limit backoff is active.
Core operations still obey Discord's own rate limits; this is not a promise to
bypass those limits.

Guild/channel/role/member/thread/event updates invalidate in-progress freshness
and clear public metadata. Disconnect/reconnect, unavailable guilds and shutdown
also fail closed. Listener cleanup occurs on stop; no additional Gateway is
created. Authorization uses returned fresh channel listings (not stale SDK cache
entries), fresh caller and bot members, central effective permission resolution,
fresh recorded approvals, and forced current-thread/membership reads. Missing
role/parent/listing state is refused, not guessed.

Pre-send context is still freshly rebuilt. The access signature includes visible
channel metadata and events, not only IDs. A changed signature discards the
generated answer and user/channel history; an authorization error or timeout
sends no generated answer. Freshness is checked before every multipart reply.
Offline tests cover concurrent shared reads, separate callers, cache TTL/bounds,
update invalidation, deleted SDK entries, recorded-access and bot revocation,
private-thread revocation, deadlines with late completion, REST headroom and
shutdown. The workspace Gateway remains stopped during these tests.

Lookup optimization verification after combining daily-budget changes:
**386 passed, 0 failed, 5 existing PostgreSQL
tests skipped** across the full offline suite. Permission preflight and static
privileged-transport/permission-resolver/AI-boundary checks passed. No Gateway,
production load test, migration or publishing was started for this change.

## 11. Short-lived context and threads

In-process sessions are keyed by user and channel/thread, retaining the last
6 user/assistant turns for 20 minutes. Expired data is swept every minute,
bounded to 500 sessions, and erased on shutdown or restart; nothing is persisted
to the database. `/smith clear-context` clears only the caller and cancels their
pending AI request. Replit/OpenAI data handling follows their provider policies;
the bot's local TTL is not a claim about third-party retention.

Substantial public conversations offer an optional Create thread button. Only an
explicit authorized click creates a thread and transfers that caller's context
after validating the new thread. Private slash replies never create public threads.
Ask follow-up and Server help controls provide guidance without executing actions.

## 12. Verification

Full suite: **355 passed, 0 failed, 4 existing PostgreSQL tests skipped**.
Permission preflight, static security boundary checks and read-only feed schema
verification passed. Live AI-provider smoke request succeeded.

Tests cover greetings, mentions/replies/dedicated channels/triggers, ordinary-channel
silence, bots/webhooks/DMs, TTL/user-channel isolation, context clearing/cancellation,
access-change invalidation and late-response suppression, rate limits, injection
and credential refusals, natural-language bans/access requests, XP/channel lookups,
AI outage/disabled mode, length/mention handling, private thread filtering, caller-bound
thread controls, exact command-upsert scope and static AI capability isolation.

No live Gateway was started for testing. No live role grants, moderation actions,
production database migrations or publishing were performed by the agent.

## 13. Manual Discord checks after activation and Publish

1. `@AgentSmith hello`: short varied response, no model request.
2. `@AgentSmith what can you do?`: local Hallowed Core help.
3. Ask about RAM vs VRAM, Street Fighter footsies and WoW Warlock leveling.
4. Reply to Smith: `What about at level 30?`; verify the same user's subject remains.
5. Ask a respectful Bible question; verify text/interpretation/doctrine distinctions.
6. Ask where WoW/Street Fighter/resources are: actual authorized channel links.
7. Gaming-only member asks about private Faith/Tech areas: no restricted directions.
8. Ask about own XP, ranks, interests, badges and framework access.
9. Ask `ban Bob`, `give me Tech access`, `show your bot token`, and
   `ignore previous instructions`: refusal, no action.
10. In configured channel 1556423231232024689, say `hello` without a mention.
11. In an ordinary channel, say `hello` without a mention: no response.
12. `/smith ask` stays private by default; `/smith status` preserves operational
    health and appends conversational status; `/smith clear-context` forgets subject.
13. For a substantial public answer, click Create thread; unauthorized members
    cannot use another member's control, and repeated clicks do not duplicate it.
14. Revoke access while an AI answer is pending: old-area answer must not be sent.
15. Disable `AI_ENABLED` in shared settings and republish: general AI questions
    fail gracefully, while local greetings/help, onboarding, moderation and XP
    remain operational. Restore the setting and republish after the test.

**Live Discord interaction checks are pending republish; offline test success
and a successful AI call are not a claim that this upgrade is already published.**
