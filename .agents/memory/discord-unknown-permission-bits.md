---
name: Discord unnamed permission bits
description: Persisted Discord permission bits can be absent from the installed SDK's named flag list.
---

Do not infer a complete permission allowlist check from discord.js `toArray()`.
Discord can retain raw bits on `@everyone` that the installed SDK does not name,
and bots inherit them even when their own role looks safe.

**Why:** A live audit revealed inherited raw bit 47 while the SDK's named
permission list omitted it. Current official Discord permission documentation
skips that bit. After initially selecting strict blocking, the user said to
leave Smith's permissions alone and that they do not care about this bit as
long as Smith cannot overpower them.

**How to apply:** Compare raw bitfields against the explicit capability data.
Honor the approved narrow exception for unnamed bit 47 inherited exclusively
from `@everyone`; do not treat it as approval for other unknown or forbidden
powers. Keep Administrator blocked, Owner immunity, and the Owner-above-Smith
hierarchy. No live role-permission edit or general reset was authorized.
Native onboarding SDK prompts/options/
roles are Collections, so use values/size rather than array length when auditing.
