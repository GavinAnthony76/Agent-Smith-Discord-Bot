# Existing framework access: Owner review

## Read-only findings — October 6, 2026

The 13:43 UTC inspection used Discord REST GETs and a PostgreSQL repeatable-read,
read-only transaction. No bot Gateway login, role changes, approval writes,
schema migration, cutover or worker execution occurred. Bots and all protected
Owner accounts were excluded using the same actual/configured-owner policy as
the role workers.

Ten non-protected members held unmatched framework access:

| Class | Count | Saved evidence | Interpretation |
| --- | ---: | --- | --- |
| Gaming only | 8 | No member record, primary, grant or approval request | Existing access with unknown provenance; not a recorded bot onboarding completion |
| Faith and Gaming | 1 | Rules acceptance and an `accept` audit, but no primary, grant or approval request | Rules acceptance does not identify the primary or approve the other framework |
| Gaming and Tech | 1 | No member record, primary, grant or approval request | Both the primary choice and additional access need human review |

All ten had `pending=false`, Member, and no Selection role. This is not proof
they never chose a community historically. No saved bot framework-assignment
audit existed for these cases. Discord refused the member-role-update audit
read with HTTP 403/code 50013, so the actual assigning actor/time is unknown.
Neither manual assignment nor an earlier native mapping is established by this
evidence. Do not broaden Smith's permissions to obtain this history.

The current saved native question was enabled, required, single-choice and
before-join, mapping exclusively to Selection roles. Its current configuration
does not prove what was configured when these members joined. Unsaved Owner
drafts are not observable. Legacy onboarding remained enabled.

## Timing and failure classes

- A clean member with no existing framework waits for explicit screening
  completion and exactly one Selection before native initialization.
- A committed accepted primary can safely recover a missing Member/primary role
  after a partial Discord write; this is saved intent, not unrecorded access.
- No Selection explains why the old worker waited for these ten members, but
  waiting longer cannot supply missing human decisions or provenance.
- A matching Selection acquired later must not automatically convert an older
  unexplained framework into a primary. Such access is now blocked for review,
  whether or not the Selection is present. No held roles are removed.
- A saved, accepted primary and human-reviewed extra grants remain valid and
  are preserved. Changed native answers never replace that primary.
- Legacy `/join` performs its Discord grant before its primary-record commit;
  a failed transaction could theoretically leave a role without a record.
  No available evidence establishes that this happened to the ten cases.

## Owner-approved resolution boundary

The Owner selected case-by-case human review and said: “i will manually right
click their names and assign them the appropriate roles”.

Smith must leave the existing access and persistent records unchanged. The
Owner did not identify confirmed primaries or approve individual extra grants,
so this investigation writes no reconciliation records. Manual Discord role
assignment changes access, not Smith's approval ledger; warnings can remain.
No new automatic adoption, blanket exemption, or historical approval is allowed.

If records are to be reconciled later, obtain explicit decisions for each
non-protected member: confirmed primary, separately reviewed extras, and evidence
of rules acceptance. Record the actual new review time and actor, not an invented
historical choice/approval date. Preserve existing XP, trivia, acceptance, grants
and audit history. Do not use `/revoke` or role removal merely to make the audit
pass. Protected accounts remain outside this process.

Use `node src/native-diagnose.js` from this directory for a fresh read-only
snapshot; it excludes protected accounts and reports the current native decision
for each mismatch. This document is an evidence snapshot, not a live roster.
