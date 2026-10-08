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

The Owner selected OpenAI through Replit AI Integrations, billed to Replit
credits rather than a personal OpenAI API key.

**Why:** This billing choice was explicitly confirmed before provisioning.

**How to apply:** Keep provider credentials isolated from model context. Do not
silently switch billing accounts or request a personal API key for this layer.
Dedicated plain chat requires Discord's Message Content authorization: confirm
it before enabling the SDK intent so the conversation upgrade does not take the
otherwise stable bot offline.
Verify this through read-only application metadata, not an additional test
Gateway connection; the single-instance hosting constraint still applies.

Do not rely on Gateway invalidation alone to justify a permission TTL cache.
Freshness-sensitive sharing is allowed only when every caller requested the
read before its dispatch; later callers must obtain another fresh snapshot.

**Why:** Disconnects can hide revocations, and the SDK's guild-wide fetch does
not necessarily evict deleted entries from its local cache. A successful fetch
plus a cache hit is not proof that the object is still in the authoritative list.

**How to apply:** Keep caller/bot roles, recorded approvals and private-thread
membership freshly read. Use returned listings and reject missing parents or
roles. Reserve TTL reuse for explicitly public, non-authorizing metadata.

Operational lookup warnings and paid-AI allowance notices require separate
opt-in policies; neither authorizes unsolicited community conversation.

**Why:** The Owner specifically required slow-lookup warnings to remain separate
from paid-AI allowance notices and to contain only aggregate fixed-label counts.

**How to apply:** Keep operational notification consent specific to its purpose
and to the current human Owner. Do not treat another allowlisted account, an
ownership transfer, or enabling AI as consent to receive these notices.
