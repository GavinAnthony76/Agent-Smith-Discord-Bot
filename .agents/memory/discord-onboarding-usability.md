---
name: Discord onboarding usability
description: Permission checks alone do not establish that new members can begin onboarding in a read-only channel.
---

Provide clickable acceptance and community selection in read-only onboarding; do not rely only on telling a new member to type a slash command.

**Why:** A real invited member could see the three entry channels and had Use Application Commands permission, but could not type to continue. A passing permission audit did not establish a usable member-facing flow.

The user confirmed the clickable entry flow let the invited member accept rules and select a community. Retain that entry method.

**How to apply:** Preserve read-only rules and welcome channels. Test onboarding from a non-staff member's perspective and verify that the controls are present, work before the Member role, and still enforce explicit rules acceptance and human-reviewed extra access.