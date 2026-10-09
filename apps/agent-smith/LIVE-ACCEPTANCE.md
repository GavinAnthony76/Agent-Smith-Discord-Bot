# Controlled two-server live acceptance — 2026-10-08

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
