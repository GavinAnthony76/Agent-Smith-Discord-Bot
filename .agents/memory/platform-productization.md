---
name: Smith platform productization
description: Owner's new multi-server product scope and rollout boundaries.
---

The Owner wants the existing Smith application productized into a commercial
multi-server platform with Discord OAuth, a web dashboard, configurable modules,
analytics and premium-entitlement/billing readiness.

**Why:** The uploaded platform upgrade requirements explicitly expand the former
single-server scope while requiring Hallowed Core to remain stable.

**How to apply:** Preserve Hallowed Core's three frameworks, single self-selected
primary and human-approved extras as a policy adapter. Do not weaken existing
protected-account/hierarchy rules or discard native onboarding/history. Use the
same Discord application and one Gateway client per bot process. No active
charging, aggressive public installation or sharding in this phase. Multi-server
support cannot be declared complete until Hallowed Core and a separate test guild
have both been verified. Web configuration must never bypass existing guarded
Discord mutation services.

During controlled two-server acceptance, runtime changes are authorized only in
LMOC TEST. Do not modify Hallowed Core or activate modules labeled “runtime
activation pending.”

**Why:** The Owner explicitly limited the live acceptance rollout to the eight
already-supported modules and required Hallowed Core to remain unchanged.

**How to apply:** Verify the production process can load the test guild's saved
configuration before creating live test events. Enforce the test-guild activation
boundary, including startup adoption and analytics, rather than assuming a shared
runtime's defaults are harmless. Keep one Gateway; never use the read-only
preview client as a second mutation authority.

Private previews must distinguish stored configuration from active runtime
behavior and credential availability from successful Discord authentication.

**Why:** Discord may have valid credentials but no registered OAuth callback.
The Owner's acceptance condition is working behavior in two guilds, not screens
or successful simulated tests.

**How to apply:** Mark unconnected module adapters as inactive/draft, describe
browser-intercepted checks as synthetic, and obtain an authorized second guild
before claiming commercial multi-server readiness.

SDK permission objects may be hydrated by a REST-only dashboard client, but that
client must have no Gateway session and must reject all Discord REST writes.

**Why:** A development dashboard runs while the published bot remains online.
Logging in another client would violate the single-Gateway rollout boundary;
giving the preview client write access would create a second mutation authority.

**How to apply:** Keep permission hydration separate from privileged execution.
Production web actions reuse the already-connected, guarded bot and its actual
guild services; do not make the read-only preview client privileged just to enable
an unsupported dashboard control.

The Owner authorized the private **LMOC TEST** guild, `1555330318569971743`, for
separate-guild verification. The existing Hallowed Core must not be used as its
own second-guild proof.

**Why:** The Owner supplied the separate server ID and installed the existing
Smith application there after the production server was initially supplied.

**How to apply:** Recheck the actual server identity and permissions before
controlled tests. Installation alone does not prove unpublished adapters work.
