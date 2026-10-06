---
name: Discord SDK mutation boundaries
description: SDK endpoint choices that matter when enforcing REST mutation policy
---

Allow the single-message deletion endpoint only inside a confirmed, bounded
purge scope with the same protections as bulk cleanup.

**Why:** discord.js bulkDelete uses an individual message DELETE when only one
eligible message remains. Blocking every individual DELETE breaks legitimate
one-message purges even when the interaction used bulkDelete.

**How to apply:** preserve exact channel/message binding, Owner-message
immunity, protected-channel checks, age/pin checks and authenticated actor
authorization on this fallback. Never open generic individual deletion.

Keep role changes scalar and separately guarded; do not authorize unrestricted
member role replacement to accommodate SDK batch convenience.

**Why:** SDK batch role add/remove may PATCH the member's entire role array,
rather than use single-role PUT/DELETE. That endpoint could otherwise bypass
per-role allowlists and protected-role checks.

**How to apply:** use individual role operations under the trusted workflow
scope, preserving all unrequested roles. Batch convenience is not a reason
to permit generic role-array replacement.
