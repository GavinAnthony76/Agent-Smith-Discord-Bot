---
name: Ticket rollout safety
description: Private ticket access and recovery boundaries during Smith platform rollout.
---

Ticket-panel changes affect future tickets, not the access lists of older tickets.
Closing preserves private evidence; it must not grant new support roles access to
existing messages or automatically delete the channel.

**Why:** The Owner requested private tickets limited to authorized roles. Applying
an edited panel retroactively would expose earlier intake and correspondence to a
new group without a separate review.

**How to apply:** Keep an opening-time access snapshot for closing, recovery and
future transcript exports. Apply current staff visibility checks as well.

Uncertain ticket creation or closing must not automatically resend a Discord
write. A claimed-but-unconfirmed creation stays reserved. An interrupted executor
requires explicit Owner/operator review before in-flight recovery is cleared.

**Why:** Discord and PostgreSQL are not one transaction, and SDK retries can
create more than one channel after an acknowledgement is lost.

**How to apply:** Reconcile only a unique, verified private resource. Multiple
matches need manual inspection; a browser timeout does not prove an executor has
stopped. Never automatically delete extras to make an uncertainty disappear.

Hallowed Core ticket activation needs separate policy review, not just a module
switch.

**Why:** Its existing guarded channel/access policy must remain stable; the Owner
authorized controlled testing in the separate LMOC TEST guild instead.

**How to apply:** Keep standard-server ticket writes out of the Hallowed Core
mutation path until its private-channel policy has been explicitly reviewed.
