---
name: Access notification recovery
description: Best-effort request delivery and explicit retry semantics.
---

Saved access requests remain valid when staff notification fails. Delivery is best effort; recover through human review of pending requests or an explicit resubmission of the same community. Do not add automatic delivery retries without separately considering duplicate sends and durable delivery state.

**Why:** A rejected Discord send can still have delivered a message. Claiming the request failed encourages misleading retries; claiming definite non-delivery is also unsafe. Explicit resubmissions are audited attempts, not new pending requests or approval.

**How to apply:** Keep private responses truthful about saved pending requests and unconfirmed delivery. Preserve human-only review, mention suppression, and request IDs for correlating possible duplicate notifications.
