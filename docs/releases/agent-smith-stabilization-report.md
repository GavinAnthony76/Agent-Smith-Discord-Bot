# Agent Smith — Production Stabilization Candidate

Production inspected: https://agent-smith-discord-bot.replit.app

Evidence collected October 15, 2026, America/Chicago (October 16 UTC).
This is one consolidated, **unpublished** candidate for the existing management
site, API and bot. No production database records, Discord resources, permissions,
XP, levels, achievements or consent were changed by this sprint. No second
Gateway was started. The development Bot workflow remains stopped.

## Verdict

**NOT READY — OWNER DECISION REQUIRED**

The implementation and isolated tests are complete. A live Hallowed Core policy
drift remains deliberately blocked: the tracked `mmo-adventures` Gaming forum is
now called `mmo-thread`. Its tracked ID, Gaming parent and forum type still match,
but the reviewed name-based access guard rejects it. This sprint did not rename
the forum, approve an alias, weaken that guard or publish.

The historical setup incident cannot be conclusively attributed to an actor or
request without its original trace. A concrete missing-parent-row failure was
reproduced and fixed; that is not represented as proof of the historical incident.
Authenticated production readiness and the 2.5-second dashboard target remain
unverified until an Owner-controlled production check.

## 1. Setup 500 root cause and request trace

The old wizard sent `PUT /api/platform/guilds/{guildId}/setup`, with modules and
log/welcome channel selections. The server resolves the OAuth session, checks
CSRF and guild authority, validates input, then calls the setup service.

Production SELECTs confirmed that Hallowed Core has **zero platform guild rows,
zero platform module rows and zero setup-completed audit rows**. Merely viewing
Hallowed Core intentionally does not adopt it into the generic platform.

The previous setup transaction selected a guild row for update without checking
whether it existed, updated zero rows, then inserted module rows referencing that
absent parent. An isolated real PostgreSQL reproduction returns **23503,
foreign-key violation**. No Discord operation is needed to trigger this defect.
The candidate explicitly creates the parent first during confirmed Owner setup.

A second issue was found in the production write boundary: the HTTP layer used
the standard-guild activation allowlist, which excludes native Hallowed Core.
It could therefore refuse Hallowed setup with 403 before reaching the latent
database defect. The candidate uses the existing production-writable-guild policy
at HTTP and service boundaries; this includes only currently authorized guilds,
not LMOC or arbitrary invited guilds.

Known route, input shape, function and SQL failure are documented above. **The
historical authenticated actor, exact payload, guild and exception are unknown.**
No authenticated production setup mutation was attempted. The original 500
must not be claimed as exactly reproduced. Old response handling had no usable
request correlation; new diagnostics address that gap.

## 2. Setup fix

Setup now requires current Owner authority, a successful read-only preflight,
explicit confirmation, a matching preview digest and an expected state revision.
It uses a per-guild PostgreSQL advisory lock and journal revision.

The confirmed operation creates a missing parent configuration row before child
rows, inserts missing module/entitlement records idempotently, preserves existing
module configuration and existing non-null settings, and records completion once.
Setup still creates **no Discord roles, channels, categories, forums, commands,
scheduled jobs or Gateway clients**. Its preview says so explicitly.

Hallowed Core defaults remain separate from standard-guild defaults. The native
FAITH/GAMING/TECH policy, human-reviewed additional access and Owner protection
are not copied into generic future guilds.

## 3. Setup state machine

The API exposes an observed state, classification, revision, safe-retry flag,
eight named stages, resource preview, update time and diagnostic references.
Observed initial states include NOT_INSTALLED/PREFLIGHT; existing unjournaled
configuration is VERIFYING. Confirmed attempts persist CONFIGURING, followed by
READY or DEGRADED. The contract supports the other requested state labels without
pretending every label represents an executed operation.

Classifications are ALREADY_CONFIGURED, PARTIALLY_CONFIGURED,
READY_TO_CONFIGURE and BLOCKED. Stages are Bot Connected, Permission Check,
Guild Preflight, Database Setup, Role/Channel Configuration, Command Verification,
Runtime Verification and Ready.

The journal uses the **existing** platform-record table under a reserved
system-setup collection. There is no new production table or startup migration.

## 4. Resume and uncertain outcomes

A confirmed journal survives a later configuration failure. Configuration writes
are transactional; failed module inserts roll back while the recovery journal
remains. The UI displays the failed step and reference, discards the stale preview
and requires a new preview and confirmation before Resume.

A live lease and revision checks refuse overlapping attempts. A stale lease can
be resumed after fresh checks. Completed module configurations are not reset.
Lost final commit acknowledgments cannot overwrite committed READY with a failure:
the recovery update is conditional on the same attempt still being CONFIGURING.
Repeated identical setup returns already configured without another completion
audit or resource creation.

## 5. Errors and telemetry

Admin responses distinguish 400, 401, 403, 404, 409, 422, 429, 503 and 500.
Known dependency failures and validation conditions are not unexpected 500s.
Error bodies contain a short safe message and reference ID.

Member commands retain an explicit allowlist of safe business guidance, but no
longer echo arbitrary exception messages. Raw SQL, cache exceptions, source paths,
credentials and environment contents are not returned to members.

Structured request logs contain correlation ID, guild, operation, stage, response
status, elapsed duration, dependency durations and call counts. Failure logs add a
safe failure class and recognized dependency code, without bodies, tokens or SQL.
Responses include X-Request-ID and Server-Timing. Recent diagnostic references
are bounded and guild-scoped; they reset with the process, not a durable log archive.

## 6. Actual production performance baseline

Three read-only HTTP samples per route, milliseconds, measured from this
workspace. These are HTML-shell/network measurements, **not authenticated
dashboard readiness or a controlled load test**.

| Production path | Samples, ms |
| --- | --- |
| /dashboard | 295 / 147 / 47 |
| /dashboard/1556423230590423042 | 146 / 165 / 45 |
| .../onboarding | 142 / 44 / 45 |
| .../setup | 45 / 46 / 48 |
| .../members | 47 / 47 / 43 |
| .../moderation | 43 / 44 / 44 |
| .../leveling | 43 / 46 / 47 |
| .../settings | 44 / 44 / 43 |
| .../audit | 42 / 42 / 51 |
| /api/platform/session, signed out | 374 / 48 / 46 |
| /api/readyz | 45 / 46 / 45 |

All HTML shells returned HTTP 200. A browser showed that the bare guild path
nevertheless renders a **client-side 404** in the published build. The candidate
redirects it to overview; that redirect passed the local browser check.

The published signed-out login card was visible at the first browser observation,
approximately 500 ms after navigation. This is not a separately instrumented
paint-to-ready metric. Browser-observed session resource duration was 538 ms.
Authenticated selector, overview, onboarding, setup, members, moderation,
progression, settings and audit render/API timings could not be measured without
the Owner's Discord session. Hydration was not separately measured.

Published JS: 490,684 raw bytes; locally gzip-estimated 152,062 bytes. The browser
observed 490,984 transfer bytes. Published CSS body: 118,032 bytes.

Discord read samples: roles 228 ms; fresh guild snapshot approximately 9,898 ms;
a guild-channel list approximately 15,957 ms; an individual tracked channel
212 ms. These are different endpoints and moments, not directly comparable
controlled before/after samples. They show that REST queue/rate-limit delays can
dominate otherwise fast HTML and database work.

Background production snapshot: 23 native jobs and 69 progression jobs covering
23 distinct members were deferred. Published logs continue showing native retry
and misleading missing-rank warnings; unpublished fixes cannot change those logs.

## 7. Performance improvements

Public and dashboard routes are split into lazy chunks with loading boundaries.
The bare guild route redirects correctly. Queries have a 30-second freshness
window and no focus refetch. The old 20-second overview/plan polling is removed;
active health polls every 30 seconds and pauses while hidden.

Audit pages no longer load channel/role editor resources unnecessarily. The
selector loads authorized summaries, not every guild's modules or records.
LMOC and unapproved guilds are excluded from selector expansion.

Candidate build: entry 327.50 kB (gzip 105.70), dashboard 115.32 kB (33.35),
shell 50.36 kB (15.85), public 10.08 kB (3.45), CSS 118.10 kB (20.46).
The entry chunk is about 33% smaller raw and 30% smaller gzip than the published
single entry. **A full dashboard also loads route/shared chunks**; this is not a
claim that its total first-load JS fell by 33%, or that signed-in production meets
the 2.5-second target. Cached navigation benefits from query reuse.

## 8. API and query improvements

Concurrent read-authority requests for the same guild/member are coalesced only
while in flight, not retained as a time-based authorization cache. Later reads
and all mutations obtain fresh authority. GET-guild role definitions are reused
as a fresh identity snapshot instead of redundantly fetching the entire role list;
removed cached ghost roles still cannot authorize access.

Read-only editor resource lists can use the connected production Gateway's
channel-event projection. The REST-only preview fetches its own channels. Actual
mutation authorization still refreshes channel state and protected permissions.
Operational health reads bounded local/SQL observations, not a full Discord scan.

Production read-only EXPLAIN ANALYZE samples:

| Query | Planning ms | Execution ms |
| --- | --- | --- |
| Guild configuration | 16.613 | 0.962 |
| Members page, limit 50 | 7.537 | 1.381 |
| Progression aggregate | 42.694 | 14.087 |
| Audit page, limit 50 | 6.532 | 1.265 |
| Setup journal lookup | 3.135 | 0.049 |

These include cold planning/storage effects and the read-only database path;
they are not the application's pool/network latency. Instrumentation now measures
the latter per request. Samples do not justify a speculative production index.
Existing bounded collection/history limits remain; no claim is made that every
admin history gained a new cursor-pagination UI. Existing pending-request paging
and its regression coverage are preserved.

## 9. Progression diagnosis and repair

All **21 tracked rank roles exist**, match their configured names, are unmanaged
and permission-free. No rank configuration, role creation or historical repair
was needed.

The progression audit dereferenced permissionOverwrites on cached threads and
caught the resulting exception as “Missing tracked rank.” A separate native
selection safety scan had the same thread assumption. Both now use the same
fail-closed parent-channel resolver as the published onboarding hotfix.

A read-only live progression audit using the candidate returned **zero errors**
in approximately 604 ms. The live REST channel list contained no threads; synthetic
regressions explicitly include cached threads and missing/unsafe parents.
Existing worker jobs will still reconcile only through their unchanged protected
reward-role workflow. No fabricated XP, levels, achievements or history were added.

## 10. Hallowed Core regression and remaining policy drift

Published readiness reported connected. The native runtime is now identified
truthfully in status responses rather than conflated with standard activation.
The session status lookup no longer points at retired LMOC.

Read-only live role-grant checks passed for Member, Faith and Tech. Gaming failed
on the renamed tracked forum described in the verdict. The exact tracked forum
still has the expected Gaming parent and forum type. **That is evidence of identity,
not permission to approve its changed policy automatically.**

The original thread-parent hotfix semantics remain: threads inherit their verified
parent's overwrites; missing or unverifiable parents fail closed. Offline rules
acceptance, access recovery, Owner immunity, thread-parent and rank tests pass.
No human production accept/join action was impersonated.

Health shows Worker, Gateway, Database, Selected Guild, Setup, Moderation,
Onboarding, Progression, Feeds, AI, Background Workers, Last Heartbeat and recent
errors. Unexercised moderation, AI and feed operations remain UNKNOWN rather than
healthy from flags. Worker/onboarding observations expire when stale.

## 11. LMOC exclusion

No allowlist or activation approval was added. Setup and other production writes
remain refused for LMOC and unapproved guilds. Historical handoff/release records
were preserved; the LMOC preparation button was removed from the overview.

Repeated production SELECTs show LMOC bot_connected=false, runtime_active=false,
and last_seen_at unchanged at 2026-10-15T22:08:34.650Z. Its two historical activity
rows remain, with **zero activity rows since archival**. It has zero new setup
lifecycle records. Existing archive/activation/transport tests remain passing.
This was read-only evidence, not an exhaustive audit of every external Discord
event during the observation window.

## 12. Files changed

Runtime: bot.js; permissions.js; native-reconcile.js; progression-worker.js;
new operational-health.js. Platform: activation.js; catalog.js; discord-access.js;
http.js; service.js; new setup.js, diagnostics.js and system-status.js.

Frontend: App.tsx; pages/dashboard.tsx; lib/platform.ts; components/plans.tsx;
new components/setup-flow.tsx and components/system-status.tsx.

Contracts: lib/api-spec/openapi.yaml; generated React API/hooks/schemas;
generated Zod API and setup/status types.

Tests: access-failures.test.js; helpers/bot-fixture.js; new stabilization.test.js
and stabilization.integration.js. Existing assertions that required raw internal
error text were replaced with safe-message/reference and diagnostic assertions.

Ancillary: a short channel-policy decision memory; this report; its standalone
HTML copy; the candidate manifest. The manifest lists exact source paths and hashes.
No film, public branding assets, authorization allowlist or production schema was
changed.

## 13. Schema and index changes

**None. No production migration is required by this candidate.**
The lifecycle journal uses an existing table. Disposable integration schemas were
created and dropped only in development, without public search-path fallback.
Do not copy the development database into production or run historical migrations
to publish this candidate.

## 14. Verification

- Offline suite: **475 passed, 12 skipped, zero failed** (487 tests).
- Explicit disposable-schema PostgreSQL/HTTP suite: **18 passed, zero failed**.
- Combined: **493 passing checks; 12 existing opt-in checks skipped**.
- Static privileged-transport, permission-resolver and AI-boundary checks passed.
- Offline permission/47-command preflight passed.
- Frontend typecheck and production build passed. Vite emitted non-blocking
  pre-existing component sourcemap warnings.
- Live read-only role inventory and candidate progression audit passed as above;
  the Gaming native policy check remains blocked, not suppressed.
- One browser pass verified the candidate's redirect, confirmation, preview
  invalidation, 503/reference display, fresh-preview resume, successful completion,
  all eleven supplied health statuses and 390×844 setup layout using
  **synthetic browser-intercepted fixtures**. Real transaction behavior was tested
  separately in PostgreSQL, not inferred from those fixtures.
- A simulated hidden visibility state produced zero extra health polls over
  31.5 seconds. Native background-tab visibility could not be established in that
  browser environment.
- Real published signed-out pages were inspected. The old bare guild route's
  client-side 404 was confirmed; the fixed local route renders the login card.
- Production signed-in setup, admin timings and member actions are unverified.
  No production credentials, bypass session or second Gateway was used.

## 15. Candidate fingerprint

The companion `stabilization-candidate-manifest.json` records SHA-256 file hashes
and one canonical candidate SHA-256. It covers runtime source, tests, reviewed
configuration, frontend source/assets/build configuration, generated contracts,
package/lock configuration and routing manifests. It excludes node_modules,
build output, secrets, reports and memory so this report does not hash itself.

See the manifest and the standalone report's fingerprint panel for the exact
digest. This is a source candidate fingerprint, not a claim that the currently
published deployment contains this code.

## 16. Consolidated required Owner actions

1. **Resolve the Gaming forum policy choice.** Recommended: retain `mmo-thread`
   and explicitly approve a narrowly ID-bound alias validation change, retaining
   guild, parent, forum type, permission bounds and protected-resource checks.
   Alternative: restore the canonical `mmo-adventures` name after Owner review.
   Neither action has been performed. Holding the release is also valid.
2. Review this candidate and its fingerprint after the policy issue is resolved.
   Publishing remains a separate Owner-controlled action; nothing was published.
3. After authorized publication, use the real Owner Discord session to verify the
   selector, bare guild redirect, onboarding, setup preview, one confirmed setup
   and a repeat. Capture the request IDs and Server-Timing. Do not share passwords,
   tokens or session cookies with the agent.
4. Confirm native accept/selection behavior, normal deferred-job recovery and safe
   cosmetic progression reconciliation; do not manually reset XP or grants.
   Check LMOC remains inactive and its historical records unchanged.
5. Measure signed-in initial usability and subsequent navigation in the real
   production browser before claiming the 2.5-second performance target.
   If exact attribution of the original 500 is required, provide its time, guild
   and any existing reference/screenshot—not credentials.

No new secrets, production migration, new guild activation, material permission
change or destructive operation is requested by the current implementation.

**Final verdict: NOT READY — OWNER DECISION REQUIRED.**
