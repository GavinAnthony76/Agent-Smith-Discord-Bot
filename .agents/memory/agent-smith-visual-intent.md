---
name: Agent Smith visual intent
description: Owner's brand direction and base-path constraint for isolated visual previews.
---

Agent Smith should feel like a premium, controlled cyberpunk system console:
roughly 70% premium dark UI, 20% glass/Apple-like physicality, 10% restrained
cyberpunk lighting. Not generic SaaS, a hacker terminal or loud gamer neon.
Use the user's Smith artwork; missing artwork must be identified as a placeholder,
not replaced with stock art or the separate Hallowed Core crest.

**Why:** The Owner explicitly supplied this visual direction to preserve the
existing Agent Smith identity while modernizing the platform.

**How to apply:** Keep future visual work consistent with the brand intent;
do not interpret missing telemetry as healthy systems or configured features
as live capabilities.

Asset URL construction must tolerate a preview base path without a trailing slash.

**Why:** Root-app assets rendered normally while the same extracted components
had broken images under the sandbox's slashless base path. Successful HTML
responses did not establish that the images were valid.

**How to apply:** Normalize the path boundary for portable assets and visually
verify them in the sandbox as well as the root app.
