---
name: Native Discord drafts versus saved settings
description: Distinguish the owner's current draft from the saved API snapshot when diagnosing onboarding and Server Guide.
---
Report saved API configuration separately from the owner's unsaved Discord draft; neither disproves the other. Never overwrite a draft or infer publication confirmation from an API snapshot.

**Why:** During concurrent editing, the owner described a role-free required-question draft while the saved API still included Selection roles. Server Guide save errors also occurred despite task-compatible public channel permissions, and the bot could not read saved Guide settings.

**How to apply:** Identify which snapshot each finding describes. A bot HTTP 403 on Guide inspection does not prove the owner cannot save. Generic UI errors are not grounds to broaden private access or make visit-task channels writable.
