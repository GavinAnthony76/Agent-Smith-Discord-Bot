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
