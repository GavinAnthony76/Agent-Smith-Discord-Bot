---
name: Discord onboarding usability
description: Permission checks alone do not establish usable member actions in read-only onboarding or access-request channels.
---

Provide clickable acceptance and community selection in read-only onboarding; do not rely only on telling a new member to type a slash command.

**Why:** A real invited member could see the three entry channels and had Use Application Commands permission, but could not type to continue. A passing permission audit did not establish a usable member-facing flow.

The same usability failure later affected additional community requests: a member could view the read-only request channel, and Use Application Commands was allowed, but the instruction-only message offered no usable clickable request path. Read-only member actions need accessible controls, not merely command instructions.

The user confirmed the clickable entry flow let the invited member accept rules and select a community. Retain that legacy entry method until the owner's explicit native onboarding cutover; after cutover, do not recreate the legacy controls.

**How to apply:** Preserve read-only rules and welcome channels. Before native cutover, verify that the clickable controls work before the Member role. After cutover, use Discord rules screening and inert native selection signals instead. Both routes must keep human-reviewed extra access; permission audits alone cannot verify a real member's UI experience.