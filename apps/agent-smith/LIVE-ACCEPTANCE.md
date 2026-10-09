# Controlled two-server live acceptance — 2026-10-08

**Latest checkpoint (2026-10-09 02:12–02:15 UTC): published prerequisites PASS;
overall acceptance BLOCKED on real Owner/member actions. The pre-release full
member fingerprint does not match. See the post-release checkpoint at the end.
Earlier sections below are historical observations, not current deployment status.**

## Verdict: BLOCKED — live acceptance has not passed

Authorized mutation target: LMOC TEST (`1555330318569971743`) only.
Hallowed Core (`1556423230590423042`) was inspected read-only.
No Discord writes, configuration writes, module activation, publishing, database
migration, Gateway login, or bot/workflow restart was performed during this check.

The first prerequisite failed: the existing production Gateway is connected, but
its platform API is unavailable and the managed production database has none of
the platform tables needed to load the saved LMOC TEST configuration.

## Observed before / after

| Check | Before | After |
| --- | --- | --- |
| Production `/api/readyz` | HTTP 200, `{"status":"connected","ready":true}` | Same HTTP 200 and body |
| Production `/api/healthz` | HTTP 200, connected and ready | Not repeated; no runtime change made |
| Production platform tables | 0 | 0 |
| LMOC TEST development setup | Complete, standard policy, installed | Complete, 15 saved module rows |
| LMOC TEST development activity events | 0 | 0 |
| LMOC TEST development XP events / total XP | 0 / 0 | 0 / 0 |
| LMOC TEST development economy operations | 0 | 0 |
| LMOC TEST development ticket channels | 0 | 0 |
| LMOC TEST development onboarding progress records | 0 | 0 |
| Hallowed Core production recorded members | 22 | 22 |
| Hallowed Core production progression rows | 9 | 9 |

Production `/api/platform/session`, an actual route in the new platform handler,
returned HTTP 404 with `{"error":"not_found"}`. This demonstrates that the new
platform handler is not available at the published worker; it does not alone
distinguish an unpublished build from disabled/failed initialization.

Development contains all 16 platform tables. LMOC TEST's module rows are keyed
by its own guild ID, not Hallowed Core's. Their presence does not establish that
the production process has loaded them. The database inspection was through the
managed development database and read-only managed production replica.

The dashboard preview's `botOnline` currently comes from its REST-only client's
`isReady()`. That client deliberately has no Gateway session, so its “Bot offline”
label is not a reliable statement about the persistent production bot. The
production bot is connected; LMOC TEST's platform runtime is not verified.
No label was forced to “online” to conceal that distinction.

## Requested module checks

All eight supported modules are enabled in saved development configuration.
None received a controlled live event because the first prerequisite failed.

| Module | Saved configuration / baseline | Live result |
| --- | --- | --- |
| Welcome | Channel `1555336735301308506`; role behavior `NONE` | BLOCKED; delivery not tested |
| Onboarding | Five steps including rules acceptance; no progress records | BLOCKED; new-member flow and persistent consent not tested |
| Cosmetic Roles | Empty self-assignable-role list | BLOCKED; no configured cosmetic role to select |
| Leveling | Text XP enabled; 5 XP/message; daily cap 60; no XP events | BLOCKED; guild-isolated live XP write not tested |
| Economy | 25 Community credits per daily claim; no operations | BLOCKED; live daily claim not tested |
| Tickets | No saved ticket-panel records or ticket channels | BLOCKED; opening and closing not tested |
| AI | Empty allowed-channel list and personality additions | BLOCKED; live server-specific identity/reply not tested |
| Analytics | `collectActivity=true`; no recorded events | BLOCKED; activation-time collection not tested |

No moderation, AutoMod, achievement, reward, feed, YouTube, or event adapter was
activated. Saved `enabled=true` flags for pending adapters are configuration,
not evidence that those adapters are running.

## Additional pre-release findings

- Welcome's `roleBehavior=NONE` does not add the standard onboarding start button.
  No published onboarding entry record exists. A welcome message alone does not
  prove that a new member receives the requested onboarding entry.
- The cosmetic role test needs an explicitly reviewed, nonprivileged role and an
  eligible non-owner human test member. Do not use the protected Owner or a bot
  account as a substitute.
- A ticket panel needs explicit configuration and guarded publication before a
  human member can open the controlled test ticket.
- Standard-server economy currently exposes `/smith-community daily`; do not
  claim that the legacy `/daily` command was verified in LMOC TEST.
- Source inspection found a hardcoded Hallowed Core identity in the conversation
  handler's `whoami` reply. This is a source finding, not a live test result; the
  standard-server branch needs correction before claiming that identity check
  passed.
- Platform startup currently adopts all cached guilds and analytics defaults can
  collect Hallowed Core events. A controlled release must enforce the authorized
  LMOC TEST-only activation boundary rather than enabling this path globally.

## Required before resuming

Prepare and review a release restricted to LMOC TEST, retain the one existing
Gateway process and Hallowed Core's existing behavior, and use the supported
user-controlled publishing/schema-review flow. Do not replace the production
database, clone/reset it, or add startup-time migrations.

Production must separately contain the intended LMOC TEST configuration: a
schema update is not evidence that development configuration rows were copied.
Then verify a per-guild runtime acknowledgment/status before performing real
member, interaction, role, XP, economy, ticket, AI and analytics tests.

Hallowed Core received no changes from this check, and production remained
ready. Behavioral equivalence following a new release has not been proven;
there was no release and no live two-server test in this run.

---

## Next prerequisite implementation — 2026-10-09 UTC

**Overall live acceptance: NOT PASSED / BLOCKED ON USER-CONTROLLED RELEASE.**
This section adds measured preparation results; it does not replace the initial
live findings or turn isolated/mock checks into live evidence.

### 1. Production schema changes

Production still has zero platform tables. Development now has the 16 existing
foundation tables plus the required `platform_runtime_state` table.
The supported publish-schema review returned 35 additive statements: 17 new
platform tables, their constraints and indexes, no drops/truncations, no
structural data loss and no legacy-table alterations. No production DDL was run,
and no build/startup schema migration was added.

The diff also includes the three dormant billing-foundation tables already
present in development from the earlier productization work. They are not an
activation of billing; no billing records are seeded and no payments are enabled.
Review these alongside the rest of the publish diff. Never use the overwrite-data
option or replace the existing production database.

### 2. LMOC TEST configuration transfer

`release/lmoc-config.json` contains only LMOC TEST's setup/settings and all 15
saved module configurations/revisions. Its contents were compared against the
current development module rows and matched exactly. It contains no sessions,
OAuth tokens, managers, member records, XP, wallets, consent, activity history,
tickets, audit history or unrelated guild data.

The explicit configuration-import digest staged for production is:

`7142c8ad7810cbf5a58c69d7c52a4ba15227871bf4d4bec2f6255a1291e71ce4`

After the reviewed schema/code release, the existing connected runtime can seed
this exact configuration in one audited transaction. It refuses a different
digest, Hallowed Core, an unallowlisted guild, a disconnected client, unrelated
top-level data, or an existing production setup needing reconciliation. Repeating
the same approved import preserves subsequent Owner changes rather than resetting
them. This is configuration data import, not a production schema migrator.

**Actual production import has not yet occurred.**

The only developmental configuration adjustment made by this preparation was an
audited LMOC-only insertion of a `BUTTON` step before the existing final step,
bringing the flow from five to six steps while retaining the five original steps
and the other onboarding settings. Existing saved welcome, AI, role and ticket
settings were preserved.

### 3. Allowlist state

Production `PLATFORM_ENABLED_GUILD_IDS` is staged as
`1555330318569971743` only. The allowlist defaults to empty and rejects Hallowed
Core. It gates startup, command registration, all standard events, interactions,
AI, XP and analytics. Hallowed Core bypasses standard adapters without even
standard SQL reads in the event/interaction regression.

Production platform HTTP writes outside the allowlist are refused. Viewing
Hallowed Core does not automatically adopt it or create platform/entitlement
records. This boundary does not disable or replace its existing legacy services.

### 4. Runtime status endpoint

The new operational endpoint is
`GET /api/platform/runtime-status?guildId=1555330318569971743`.
It exposes only operational booleans/timestamps and supported-module activity,
not configuration contents, identities, messages or credentials.

Status distinguishes `botConnected`, `platformEnabled`, `guildConfigured`,
`runtimeActive`, `lastSeenAt`, `activatedAt` and `moduleStates`. Production
heartbeats expire after 90 seconds; adapter status requires actual configuration
and a connected existing client. Preview polls production status but cannot
activate modules or write to Discord.

The dashboard no longer equates its REST-only preview client's missing Gateway
with production being offline. The public mobile status page was visually
verified to show **Production Gateway unverified; preview is REST-only** while
the new endpoint remains unpublished. Production readiness independently remained
HTTP 200, `{"status":"connected","ready":true}`.

### 5. Modules activated

**None by this run in production.** The release allowlist supports exactly:
Welcome, Onboarding, Cosmetic Roles, Leveling, Economy, Tickets, AI and Analytics.
Pending moderation, AutoMod, achievements, rewards, feeds, YouTube and events
remain unsupported/inactive even when their preserved configuration flag is true.

Analytics has a persistent activation timestamp, current heartbeats and an event
time check. Pre-activation messages cannot generate analytics or XP. There is no
history fetch/backfill.

### 6. Live test results and readiness

All eight live tests remain **NOT RUN**, pending release and genuine member
actions. Synthetic gateway events or manufactured interactions are not accepted
as live evidence.

Prepared standard-only behavior:

- Welcome includes a start-onboarding control when onboarding is enabled.
- Generic `whoami` uses the actual guild name and saved personality. The Hallowed
  Core identity reply is preserved byte-for-byte; its standard adapters are not
  called. The standard-server command description no longer names Hallowed Core.
- Allowlisted cosmetic roles support one-request audited selection and removal.
  Owner immunity and fresh hierarchy/privilege checks remain in effect.
- An Owner-confirmed **Prepare LMOC TEST live-test resources** action is available
  on the published overview, disabled in preview and until the adapter is active.
  It can create one zero-permission disposable cosmetic role below Smith, one
  private disposable category and one public read-only test-panel channel,
  configure/publish the test ticket panel, publish an onboarding entry and add
  a 5-credit disposable shop item. No staff role is created or assigned.
- Resource creation and publication reservations hold unknown outcomes rather
  than automatically repeating writes or deleting resources. Verified resources
  are reused; role/channel/panel drift requires review.

**No disposable resource has actually been created yet.** A genuine eligible
non-owner human member is needed for the cosmetic-role test; protected Owner
checks will not be weakened to substitute the Owner. Standard economy uses
`/smith-community daily`, `shop`, `buy` and `inventory`, not an asserted legacy
`/daily` test.

### 7. Database writes observed

Production schema/data writes by this run: **zero**.
Development writes: the additive status table and the scoped six-step onboarding
configuration/audit described above. Isolated integration tests create/drop
their own non-public schema and never use production.

No LMOC runtime history was copied or generated in the actual development
configuration. No acceptance resource/configuration records exist there.

### 8. Discord writes observed

Actual Discord writes by this run: **zero**. The resource/role/command/ticket
checks used isolated or mocked transports. The workspace bot workflow remains
not started. No client login, second Gateway, production restart or publishing
was performed.

At release, the platform reuses the bot's single existing client; guild-local
registration adds missing static command names only in LMOC TEST, never replacing
or deleting Hallowed Core's command tree. Use a single-instance cutover.

### 9. Hallowed Core before/after

Observed production member count: **22 → 22**.
Observed production progression row count: **9 → 9**.
No Hallowed Core platform or legacy configuration was changed by this run.

Content fingerprints captured as the new **pre-release** baseline:

- Members: `ab694580ee36c9363dfee3c12dff7eb4`
- Progression: `af0d8e4e6bded5e784879a8b5e08b4c5`

These fingerprints are not a measured post-release comparison. Native onboarding,
AI, roles, economy and ticket behavior still require the requested live
cross-guild comparison after release; offline regressions do not prove it.

### 10. Test counts

- Full offline regressions: **444 passed, 6 skipped, 0 failed**.
- Isolated PostgreSQL integration runner: **10 passed, 0 failed**.
- Focused activation/resource checks: **9 passed** (included in the full suite).
- OpenAPI generation/shared type checks, website and API type checks: passed.
- Website production build, offline publishing preflight, static privileged
  transport/permission/AI checks and diff whitespace check: passed.
- Mobile public status screenshot: rendered normally, no browser errors.

### 11. Warnings and remaining prerequisites

- This code/schema/data activation has not been published. Live results remain
  unknown; production configuration is not claimed present.
- SAST reports the previously reviewed medium session-cookie warning; no new
  high/critical source finding was reported. The older dependency findings were
  not re-audited or remediated in this scoped preparation.
- The website build emitted nonfatal existing UI sourcemap warnings.
- Verify the production OAuth callback through the published session endpoint
  before using the Owner preparation action; preview OAuth is not production
  OAuth evidence.
- Review the additive schema changes without overwriting production data, retain
  one Gateway, then verify the configuration-import audit, activation timestamp,
  fresh per-guild heartbeat and module states before any live member tests.

### 12. Verdict

**Prerequisite implementation prepared and checked. Live two-server acceptance
has NOT PASSED.** User-controlled publishing and the subsequent measured live
test/cross-guild comparison are still required. Do not mark the overall upgrade
or live acceptance complete.

---

## Post-release checkpoint — 2026-10-09 02:12–02:15 UTC

Authorized live mutation scope remains LMOC TEST only. This checkpoint performed
read-only production SQL, public HTTPS probes, environment inspection and log/source
review. No application code, production configuration, schema, database records or
Discord resources were modified by the agent. No publishing, workflow restart,
bot login or second Gateway was performed.

### 1. Production readiness — PASS

Publishing metadata confirms a successful public Reserved VM release at
`https://agent-smith-discord-bot.replit.app`.
At approximately `02:12:50Z`, `/api/readyz` and `/api/healthz` both returned HTTP
200, `{"status":"connected","ready":true}`. Release logs contain the existing
worker's readiness message at `00:38:31.388Z`.

This confirms connected/ready status, not an independent enumeration of all
Discord sessions. The agent did not start another process.

### 2. Runtime status — PASS

`GET /api/platform/runtime-status?guildId=1555330318569971743` returned HTTP 200:

```json
{
  "botConnected": true,
  "platformEnabled": true,
  "guildConfigured": true,
  "runtimeActive": true,
  "lastSeenAt": "2026-10-09T02:12:33.277Z",
  "activatedAt": "2026-10-09T00:38:31.686Z",
  "moduleStates": {
    "welcome": true, "onboarding": true, "roles": true, "leveling": true,
    "economy": true, "tickets": true, "ai": true, "analytics": true
  }
}
```

The heartbeat was approximately 17 seconds old, within its 90-second lifetime.
Read-only SQL subsequently observed it advancing to `02:13:13.282Z`.
The production session endpoint is published, reports `runtimeMode=production`,
`botConnected=true`, `oauthConfigured=true`, `oauthCallbackRegistered=true`.
The checking HTTP client is unauthenticated; this is not an Owner login test.

### 3. Production schema — PASS

All 17 intended `platform_*` tables are present, including
`platform_runtime_state`. No schema change is needed or attempted. This presence
check is not a comprehensive independent constraint/index audit. The dormant
billing tables exist without billing activation.

### 4. Exact configuration import — PASS

One successful `reviewed_configuration_import` audit exists, at
`2026-10-09T00:38:30.972807Z`, for LMOC TEST and exactly the approved digest:

`7142c8ad7810cbf5a58c69d7c52a4ba15227871bf4d4bec2f6255a1291e71ce4`

It records all 15 module configurations. Production has one standard-policy
guild, LMOC TEST, with `setup_complete=true` and `installed=true`. All 15 saved
module rows/revisions are present, including onboarding revision 3 and welcome
revision 2. No re-import, overwrite, reset or copying of history was performed.

### 5. LMOC-only activation — PASS; resource preparation — BLOCKED

Production environment inspection confirms:

- `PLATFORM_ENABLED_GUILD_IDS=1555330318569971743`
- `PLATFORM_LMOC_CONFIG_SHA256` equals the approved digest above.

Hallowed Core's status returns HTTP 200 with `botConnected=true` but
`platformEnabled=false`, `guildConfigured=false`, `runtimeActive=false`, null
activation/heartbeat and empty module states. Production contains no Hallowed
Core platform-module, XP, activity or ticket rows.

Only the eight supported adapters report active. The seven unsupported modules
retain saved enabled flags but are absent from active runtime module states.

The real Owner-confirmed preparation flow has **not** run: LMOC TEST has zero
`platform_records` rows, including no acceptance reservations, cosmetic role
configuration, ticket panels, onboarding entry or shop item. Preparation requires
the real Owner's Discord OAuth session and confirmation. No session/token was
manufactured or recovered, and no direct REST/SQL bypass was attempted.

Owner next action: sign in at the published dashboard, open
`/dashboard/1555330318569971743/overview`, then click
**Prepare LMOC TEST live-test resources**. Record its success/error before retrying;
uncertain outcomes must be inspected, never automatically replayed.

### 6–13. Supported-module live acceptance — all BLOCKED

For each row below: module state **active**; agent-performed Discord action
**none**; observed genuine test-specific database writes **zero**; test-specific
Discord writes **zero**. Timestamp of baseline inspection: `02:13Z`.
Production contains zero LMOC activity events, XP events, member profiles, ticket
channels and AI-period rows. No test resources or real interaction were fabricated.

| # | Module | Status | Required genuine action / evidence still missing |
|---|---|---|---|
| 6 | Welcome | BLOCKED | A real new human joins; inspect actual welcome and start-onboarding control. No join or welcome evidence exists. |
| 7 | Onboarding | BLOCKED | Human starts and completes all six steps; verify consent and persisted resume state. No entry/progress/consent record exists. No production restart performed for this test. |
| 8 | Cosmetic Roles | BLOCKED | Eligible non-owner human selects then removes the prepared zero-permission role; verify actual membership and audits. Owner safeguards remain intact. |
| 9 | Leveling | BLOCKED | Real eligible human message, observed 5-XP write, cooldown/cap boundary and guild isolation. Zero XP events; configured behavior is not a measured live result. |
| 10 | Economy | BLOCKED | Human invokes `/smith-community daily`, `shop`, `buy` with confirmed 5-credit item price, and `inventory`; inspect LMOC wallet/ledger/inventory. No economy records exist. |
| 11 | Tickets | BLOCKED | Human opens a ticket from the published disposable panel, inspect actual channel ACL, close it, verify audit/history. No panel or ticket exists. |
| 12 | AI | BLOCKED | Human interacts in an authorized location and invokes identity/help; inspect LMOC personality/identity and protected-action refusal. No live response was triggered. |
| 13 | Analytics | BLOCKED | Observe a controlled genuine post-activation event. Existing activity count and pre-activation activity count are both zero; no backfill observed, but positive live collection is untested. |

The agent cannot act as a genuine Discord human through the bot token. The
unauthenticated HTTP probe does not demonstrate whether the Owner is already
signed in in their own browser. Human actions and Owner preparation are needed;
credential sharing and synthetic events are not substitutes.

### 14. Production database writes

**Agent-initiated production writes during this checkpoint: zero.**

Observed writes made by the release/runtime, distinguished from agent actions:

- Reviewed LMOC guild/configuration import and its one import audit at `00:38:30Z`.
- Two command-registration security intent/result pairs at `00:38:32Z`.
- Continuing LMOC runtime heartbeat updates.
- Existing Hallowed Core maintenance reconciliation updates, including
  `last_reconciled_at` for 21 of 22 members. These are not LMOC test writes.

No LMOC live-test history was seeded. No billing activation or destructive schema
operation occurred.

### 15. Discord writes

**Agent-initiated Discord writes: zero.**

Release audit records show two `commands.register` operations with
`source=platform-commands`, `status=completed`, LMOC guild only, at
`00:38:32.377Z` and `00:38:32.841Z`. The corresponding source adds the two missing
guild-local command names without replacing/deleting an existing command tree.
This is audit evidence of registration, not a live invocation/response test.

No acceptance resource, welcome, onboarding publication, role assignment/removal,
test message or ticket action was performed in this checkpoint. Read-only SQL
cannot enumerate every independent legacy/background Discord write.

### 16. Hallowed Core comparison — incomplete; exact member fingerprint FAIL

| Measure | Pre-release supplied baseline | First post-release read | End of read-only checkpoint |
|---|---|---|---|
| Recorded members | 22 | 22 | 22 |
| Progression rows | 9 | 9 | 9 |
| Full members digest | `ab694580ee36c9363dfee3c12dff7eb4` | `e2f02a8a2feb0dfcf439a49021232fc7` | `5c7abaece6f6547289014e2bb93985a8` |
| Progression digest | `af0d8e4e6bded5e784879a8b5e08b4c5` | same | same |

**The exact full member fingerprint is NOT equivalent to the pre-release digest.**
It also changed during this read-only checkpoint. Existing maintenance source
runs roster scans every five minutes and updates `last_reconciled_at`; SQL found
21 reconciled member rows with timestamps `02:13:32.955Z`–`02:13:58.005Z`.
This identifies a concrete volatile field/ongoing writer capable of changing the
full-row digest without an LMOC action. It does **not** prove that timestamps are
the only differences from the original pre-release rows.

A new diagnostic digest excluding only `last_reconciled_at`, captured at the end
of this checkpoint, is `05ab3e52e7609ee59f1dcd1ca2f0c6ef`. There is no matching
pre-release semantic digest to compare. Do not retroactively ignore fields and
declare the original fingerprint requirement passed.

Onboarding, AI, roles, economy and tickets: **behavioral equivalence unproven**.
No Hallowed Core interaction was generated to test them. Its standard adapters
remain excluded, and the existing worker is ready, but these facts alone cannot
prove unchanged legacy behavior.

### 17. Test counts

- Required post-release readiness/schema/configuration/activation checks:
  **5 PASS**.
- Supported-module controlled live tests: **0 PASS, 8 BLOCKED**.
- Exact Hallowed Core full member fingerprint comparison: **FAIL**.
- Hallowed Core counts/progression digest: unchanged; behavioral comparison incomplete.
- Resource preparation: **BLOCKED**, not attempted without real Owner auth.
- No offline tests, integration runner or browser-testing subagent rerun in this
  checkpoint. Earlier 444-pass/6-skip and 10-pass results remain historical,
  not new live counts.

### 18. Warnings

- Real Owner sign-in/confirmation and genuine human member interactions are
  required. A non-owner eligible member is necessary for the protected role test.
- Exact Hallowed Core member digest mismatch must not be suppressed; original
  logical-content equivalence cannot be established from a full hash alone.
- Publish logs had transient startup health-check failures before readiness.
  Current health checks pass. A nonfatal PostgreSQL SSL-mode compatibility warning
  was also logged; no credential values were exposed.
- Prior security/dependency findings were not re-scanned or remediated.
- No unsupported module was activated, and no billing was enabled.

### 19. Final verdict — BLOCKED

Published prerequisites **PASS**. Overall live two-server acceptance remains
**BLOCKED** on Owner preparation, actual human interactions and the outstanding
Hallowed Core equivalence evidence. It is **not PASSED** and is not marked complete.
No code fix or repeat publishing is currently justified by the measured
prerequisite results.
