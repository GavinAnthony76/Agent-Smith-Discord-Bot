---
name: Discord native onboarding read limit
description: Recovery workers must not reread native onboarding per member and framework.
---
Cache and share native onboarding UI metadata briefly between worker checks; continue fetching role permissions and channel overwrites freshly.

**Why:** The live endpoint returned HTTP 429 with a five-request limit when rank recovery reread it per framework. Startup reconciliation stalled despite healthy PostgreSQL and a running bot.

**How to apply:** Reuse one in-flight/native metadata snapshot for up to 60 seconds. Explicit operator audits remain fresh. Do not extend that cache to actual permission checks or member eligibility.
