---
name: Discord unnamed permission bits
description: Persisted Discord permission bits can be absent from the installed SDK's named flag list.
---

Do not infer a complete permission allowlist check from discord.js `toArray()`.
Discord can retain raw bits on `@everyone` that the installed SDK does not name,
and bots inherit them even when their own role looks safe.

**Why:** A live audit revealed inherited raw bit 47 while the SDK's named
permission list omitted it. Current official Discord permission documentation
skips that bit, but no exemption from the strict startup rule was approved.

**How to apply:** Compare raw bitfields against the explicit capability data.
The user explicitly chose to keep the strict block and prepare an Owner-controlled
one-bit repair rather than authorize an exception. Do not silently mask unknown
bits, loosen the allowlist, or apply live role changes through Smith.
Native onboarding SDK prompts/options/
roles are Collections, so use values/size rather than array length when auditing.
