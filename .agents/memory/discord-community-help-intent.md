---
name: Community help restriction intent
description: Owner confirmation to preserve the extra everyone Send Messages denial on community-help.
---

Keep community-help's extra `@everyone` Deny Send Messages and recognize it in
the audit rather than rewriting live permissions.

**Why:** The Owner explicitly selected “Keep it and recognize it in the audit”
after a read-only comparison showed this was the only difference and that Member
and Smith overwrites matched the blueprint. Members retain their explicit posting
allow; no Discord permission edits were authorized.

**How to apply:** Recognition is limited to the reviewed channel, parent category,
guild, Member role, principal type and exact extra denial. Do not generalize this
approval to other restrictions, grants, channels or replacement identities.
