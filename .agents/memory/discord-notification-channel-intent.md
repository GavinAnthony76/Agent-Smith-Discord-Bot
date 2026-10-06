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
