---
name: Permission validation timing
description: Live fresh-authority reads may wait longer than a short mutation scope permits.
---

Budget fresh authorization separately from the short lifetime of the authorized
write. Start the write freshness window after the fresh checks finish, keep
validation bounded, and recheck the write deadline after audit storage.

**Why:** LMOC Owner preparation spent over 40 seconds on live permission reads
and was denied before panel dispatch by a scope started before those reads.
The failure was timing, not evidence that authorization should be relaxed.

**How to apply:** Preserve exact one-use mutation scopes and all authorization
checks. Recover a held operation only on explicit Owner confirmation and a
reservation-bound audit proving a pre-dispatch denial with no intent/result;
unknown delivery remains held.
