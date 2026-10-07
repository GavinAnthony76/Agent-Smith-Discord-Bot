---
name: Discord maintenance rollout
description: Preserve the working native enrollment path while introducing optional staged activation and automation.
---

Additional staged enrollment is an explicit Owner rollout, not an automatic migration of existing members. Keep the current native path operational while the Owner verifies the new staged path.

**Why:** The maintenance upgrade must preserve working behavior and real records; a new staged policy cannot establish what historical members accepted or which older roles humans approved.

**How to apply:** Do not silently enable staged activation, rewrite native onboarding or force existing members through it during later maintenance. Obtain a clear Owner choice before activating the optional flow. Use current human consent and approval timestamps, never invented historical ones.
