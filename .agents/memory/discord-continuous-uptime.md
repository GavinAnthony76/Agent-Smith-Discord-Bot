---
name: Smith continuous uptime
description: The Owner requires Smith to stay online without an active development session.
---

Smith must remain online when the Owner is away from the workspace.

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
does not authorize purchasing hosting, publishing, stopping the workspace bot or
adding an HTTP server. Keep publishing and the single-instance cutover separate.
