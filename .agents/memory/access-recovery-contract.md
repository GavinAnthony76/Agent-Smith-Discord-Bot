---
name: Access approval recovery authorization
description: User-approved scope and constraints for recovering failed human access approvals.
---

The user explicitly approved guarded compensation after confirmed approval-storage rollback. Only a newly acknowledged role addition from the failed attempt may be removed, after fresh locked checks show no saved justification. Preserve pre-existing legitimate access and ambiguous Discord/database write outcomes; report that staff reconciliation is required rather than guess.

**Why:** Discord writes cannot be rolled back with PostgreSQL, and removing access on a lost acknowledgement could revoke legitimate access. The user approved this conservative approach rather than unconditional role removal.

**How to apply:** Keep human-review eligibility unchanged. Approval of this recovery contract does not authorize migrations, live-service contact, or a live bot restart. Obtain separate authorization for those operations.
