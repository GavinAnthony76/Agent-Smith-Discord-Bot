---
name: Channel policy drift
description: Preserve fail-closed access checks when a tracked channel is renamed.
---

A tracked channel rename is not permission to relax the reviewed native access
policy. Verify the tracked ID, parent, type and overwrite bounds, then obtain
Owner policy approval before accepting an alias or changing the live resource.

**Why:** A read-only stabilization audit found that a Gaming forum retained its
tracked identity and category but its changed name blocked native access
validation. The sprint explicitly reserved unclear policy decisions to the Owner.

**How to apply:** Do not recreate roles, reset member history, rename channels or
globally remove name checks to make an audit pass. Present bounded options that
retain protected-resource and permission checks. Keep the guard closed pending
the Owner's decision.
