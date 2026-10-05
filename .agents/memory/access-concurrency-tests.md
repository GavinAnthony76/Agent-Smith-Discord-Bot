---
name: Access concurrency tests
description: Isolation and overlap requirements for testing human-reviewed Discord access races.
---

Concurrency checks should force one transaction to remain open while another demonstrably waits, with transaction-local writes and fresh reads after the lock is acquired. Keep these tests isolated from the live database and guild.

**Why:** Sequential ID reuse and already-reviewed refusal passed with a fixture that merely recorded lock calls. That did not establish that overlapping submissions or conflicting reviewers could not duplicate access effects.

**How to apply:** Use an explicitly disposable test database or a focused transaction/lock fake. Exercise unique-key and row-lock waits independently of broader member serialization, as well as the complete bot path. Preserve committed winners when losing transactions roll back. A focused fake is not evidence of all PostgreSQL semantics.
