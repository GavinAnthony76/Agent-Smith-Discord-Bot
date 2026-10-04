---
name: Discord permission validation
description: Why advertised bot permissions must not be treated as proof that provisioning can succeed.
---

Treat Discord's effective permission calculations as preflight only. Require successful API writes and a subsequent audit before reporting that provisioning is complete.

**Why:** Hallowed Core's bot had the expected server and channel permission flags, no timeout, and no server-wide moderator 2FA requirement, but Discord still denied both bulk and granular channel-overwrite updates with Missing Permissions. The advertised flags did not identify the actual restriction.

**How to apply:** Fail closed on API permission errors, preserve the resource ledger and existing channel contents, and report the specific rejected operation. Do not silently grant Administrator or repeatedly retry equivalent requests; server-owner intervention may be needed even after read-only permission checks pass.