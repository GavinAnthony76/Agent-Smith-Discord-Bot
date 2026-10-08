---
name: Standard onboarding boundaries
description: Conservative privacy and role boundaries for the first standard-server onboarding rollout.
---

Standard-server self-assignment is limited to explicitly configured cosmetic
roles. Private-channel access, staff/security roles and human-reviewed extras
must not be silently treated as ordinary role choices.

**Why:** A seemingly harmless role can expose private ticket or staff history
through channel overwrites. Dashboard configuration is not a substitute for
reviewing those access boundaries.

**How to apply:** Revalidate the role's live permissions, hierarchy and channel
grants before assignment. Keep Hallowed Core on its existing native policy.
Role groups and human-review behavior need their own complete implementation
rather than claiming the cosmetic path implements them.

Missing standard-server commands may be added as guild-local static definitions;
existing names must not be silently replaced to resolve a conflict.

**Why:** This rollout adds commercial features to the same Discord application,
not a new disposable application, and must preserve existing command behavior.

**How to apply:** Keep command registration separate from module activation,
preserve Hallowed Core's registration, and review incompatible existing names
before any replacement. Identity-only preview clients remain read-only.

Onboarding questions currently acknowledge transient member input but do not
retain answers. They are not a staff questionnaire or a later review inbox.

**Why:** The initial configuration-builder requirement did not establish a
purpose or retention policy for free-form private responses.

**How to apply:** If later work needs staff-reviewed answers, design the access,
retention and disclosure behavior explicitly. Do not start saving question text
in audit logs, analytics or model context as an incidental extension.

Welcome messages never grant roles solely because someone joined. Unknown sends
remain held rather than being automatically replayed.

**Why:** Enrollment must reflect real member action, and Discord plus SQL cannot
guarantee exactly-once delivery after an acknowledgement is lost.

**How to apply:** Offer start/resume onboarding, preserve actual consent and do
not infer acceptance from a join event or an earlier configuration revision.
