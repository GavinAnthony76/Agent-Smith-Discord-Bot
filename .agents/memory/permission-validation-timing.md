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

Legacy publication-denial audits may lack a publication/entry identifier. Do not
associate them with any arbitrary held revision; accept only unambiguous evidence
and add exact publication identifiers to new audits.

**Why:** The first onboarding denial could be proven pre-dispatch but had no
entry identifier. Multiple possible entry reservations would make attributing
that denial unsafe.

**How to apply:** Require one unambiguous legacy reservation or an explicitly
matching new identifier, plus no dispatch intent/result since its reservation
boundary. Keep the original Owner and fresh permission checks in force.
