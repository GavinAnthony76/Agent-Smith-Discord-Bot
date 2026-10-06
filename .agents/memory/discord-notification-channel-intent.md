---
name: Discord notification destination
description: Preserve the Owner's intentional separation of system/bot notices from general conversation.
---

The user added `#bot-spam` and moved system-message spam out of `#general`.
Preserve that arrangement when reconciling server audits.

**Why:** The user explicitly moved those messages to stop spam in general conversation.

**How to apply:** Do not undo the notification destination or remove the manually
created channel merely because a fixed-blueprint audit calls it unmanaged.
Review its visibility and track approved manual resources separately.

The Owner confirmed that Members should keep the existing ordinary communication
access to the private `#bot-spam` channel. Approval applies to the reviewed
channel identity, not every channel with that name or every system-message destination.
Stricter visibility remains acceptable.

**Why:** The Owner explicitly approved retaining current Member access after a
read-only inspection showed communication grants and no management permissions.

**How to apply:** Keep approval separate from blueprint provisioning. Do not
rewrite live overwrites to match a fixed template, or extend this approval to
framework, selection, cosmetic, or management permissions.
