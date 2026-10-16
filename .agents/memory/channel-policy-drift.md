---
name: Channel policy drift
description: Preserve fail-closed access checks when a tracked channel is renamed.
---

The Owner explicitly approved retaining the current Discord name `mmo-thread`.
Do not rename it back to `mmo-adventures` merely to satisfy an old canonical-name
check. For this reviewed forum, treat the name as display metadata, not identity.
Bind validation to the reviewed Discord resource ID and require the correct
guild, expected parent/category and forum type, current permission bounds,
protected-resource rules, Smith access/hierarchy and no unexpected privilege
expansion. If its identity, parent, type or security checks change or fail, stop
and require review. Preserve setup recovery/idempotency protections.

**Why:** The Owner chose identity-bound validation after the stabilization audit
found that a name-only check rejected the renamed but structurally intact forum.
This is explicit approval for that reviewed resource, not a blanket exception.

**How to apply:** Do not recreate roles, reset member history, rename channels or
globally remove name checks to make an audit pass. Keep this exception bounded to
the reviewed resource. Other policy changes still require Owner approval, and
publication remains a separate Owner-controlled action.
