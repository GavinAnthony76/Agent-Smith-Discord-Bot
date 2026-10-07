---
name: Feed delivery recovery
description: The safety tradeoff for uncertain feed posting and optional thread creation.
---

Prefer a held or missed feed entry over a duplicate after a lost acknowledgment. Do not add automatic reposts or thread retries to unconfirmed operations; Owner review may confirm an existing post or suppress the operation without creating another.

**Why:** Discord delivery and PostgreSQL acknowledgment are not one atomic operation. A successful remote write can look like a failure locally, and Discord nonce deduplication is not a durable exactly-once guarantee.

**How to apply:** When adding recovery behavior, do not treat a timeout or a locally failed acknowledgment as proof that Discord did not receive the post. Owner review must not silently authorize another send.
