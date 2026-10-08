---
name: Smith conversation upgrade boundaries
description: Owner scope and privacy rules for the conversational layer.
---

Add conversation to the existing Agent Smith; do not rebuild the stable bot,
create another bot, or change the existing deployment architecture.

**Why:** The Owner's uploaded conversational upgrade requirements explicitly
preserve the operational bot and its runtime.

**How to apply:** Keep conversation separate from privileged command workflows.
Natural language and generated recommendations never grant access, mutate roles,
or execute moderation. Preserve human authorization, hierarchy checks, protected
resources, confirmations and audit logging on the existing explicit paths.

Expose server context only within the caller's authorized access. Exclude private
moderation records and credentials from model input and conversational output.
Use actual server/member state rather than inventing resources or achievements.

**Why:** Framework-aware disclosure and the safe administration boundary are
explicitly marked as critical in the requirements.

**How to apply:** Treat prompts as untrusted. Give the conversational model no
privileged capabilities. Short-lived conversation context must expire in roughly
15–30 minutes, not become permanent AI memory. Simple greetings should be local;
AI outages must not interrupt the rest of Smith. Do not enable unsolicited
server-wide replies or scheduled conversation messages.
