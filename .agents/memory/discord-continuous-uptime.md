---
name: Smith continuous uptime
description: The Owner requires Smith to stay online without an active development session.
---

Smith must remain online when the Owner is away from the workspace.
The Owner repeated: “the bot should be online 24/7.”

**Why:** The user said the biggest issue is that the bot is always offline and
explicitly requested that it remain online.

**How to apply:** Treat unattended hosting as a product requirement. Restarting
the development workflow is not a permanent uptime solution. The user selected
Replit Reserved VM preparation, with price review and user-controlled publishing.
Preserve the live database and keep only one active bot instance at cutover.

The Owner explicitly approved using the unused API artifact's production
configuration to launch Smith, while leaving API source/development unchanged.

**Why:** The Owner selected “Configure Smith’s worker” after that exact production-only scope was explained.

**How to apply:** Do not request the same launcher approval again. This approval
does not authorize purchasing hosting, publishing or stopping the workspace bot.
The later status-check approval below is the narrow HTTP exception. Keep
publishing and the single-instance cutover separate.

The full Publishing screen may not show a separate background-worker selector.

**Why:** The Owner supplied the entire screen; it showed Reserved VM and resource
selection but no separate application-type or port controls.

**How to apply:** Do not ask the Owner to find a missing worker selector. Do not
infer worker readiness solely from the Reserved VM label.

The Owner subsequently approved “Add status check (recommended)”: a minimal
process-status and Discord-readiness check, with no member data, secrets or dashboard.

**Why:** The published artifact continued enforcing HTTP startup probes despite
the saved worker-only configuration, while Discord's exhausted login allowance
required the process to wait without claiming to be connected.

**How to apply:** Keep Reserved VM hosting and one Gateway process. The narrow
status surface is approved; no broader API/dashboard is. Distinguish process
liveness from actual Discord readiness, and never report online based only on
a successful build or hosting check. Publishing remains user-controlled.

The approved status-check approach was verified to permit live VM promotion
while Discord readiness remained false during a login-allowance wait.

**Why:** After the Owner confirmed publishing completed, the published liveness
route returned 200 with a waiting status while the readiness route returned 503.

**How to apply:** Keep these checks distinct. A waiting worker can be correctly
hosted without the bot yet being online; never turn waiting into readiness merely
to satisfy hosting.
