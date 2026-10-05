# Access failure checks

Run with `pnpm --filter @workspace/agent-smith run test`. The actual
`src/bot.js` interaction listener runs in a closed VM import graph with fake
Discord, configuration, storage, moderation, and native workers. No credentials,
network connections, migrations, or live services are used.

`access-failures.test.js`, `access-recovery.test.js`, and `transaction.test.js`
enforce the explicitly approved guarded recovery contract. Passing tests do
**not** mean cross-service decisions are atomic.

| Injected failure | Persisted and external outcome | Private reply and retry risk |
| --- | --- | --- |
| Role add rejects before mutation or after a successful write | Request stays pending; no grant or review audit; role may exist | Reply explicitly warns that Discord confirmation is uncertain and staff reconciliation is required. No speculative removal. A later human approval skips adding a currently held role. |
| Grant insert, decision update, durable audit, or explicit abort/constraint COMMIT rejection after acknowledged role add | After confirmed rollback, recovery reacquires the member lock and reads the request, member record, grant, and Discord member afresh | Remove only this attempt's new role if the request still matches and is pending, with no saved grant or primary-community justification. Reply states that approval was not saved and the new role is absent. Member request retries reuse the pending ID; another human review can approve. |
| Member already held the role before this approval | Storage failure leaves existing access untouched | Never add again or compensate pre-existing access. Fresh pending records allow a human retry; conflicting current records require reconciliation. |
| Saved grant, primary community, or changed request decision discovered during recovery | Preserve access even if this attempt added the role | Reply states that current records require preserving access and staff reconciliation is required. |
| Recovery read, member fetch, role removal, or recovery transaction fails | Approval was rolled back; access may remain | Reply explicitly warns that recovery could not be confirmed. A later human approval records the decision without adding an already-held role again. |
| Lost COMMIT acknowledgement, disconnect, or failed ROLLBACK | Commit outcome is unknown; approval may already be durable | Successful later ROLLBACK does not prove COMMIT failed. Preserve access, discard uncertain database clients, retain the original error, and request staff reconciliation before retry. |
| Review-channel fetch or send rejects after request commit | Request and durable request audit remain; no access granted; injected failures deliver no notification | Private reply identifies the saved pending request, unconfirmed staff notification, and manual recovery. `/pending` still exposes the request. Explicit retry reuses its pending ID, records another request-attempt audit with that ID, and attempts notification once. |
| Private reply rejects after request commit | Saved pending request, audit, and notification attempt remain | Log identifies the saved request; staff can recover with `/pending`. No generic “Unable to complete” replacement is attempted. |
| Request audit or known COMMIT rejection | Request and audit roll back; no access or notification | Generic private failure remains appropriate; no saved-request claim is made. |

Both menu/slash request paths and button/slash approval paths are exercised.
Faults are one-shot and targeted so review notification failures do not also
disable the audit mirror. Transaction-local writes include only durable records:
rolling back PostgreSQL cannot roll back a Discord role.

The fixture uses the production transaction wrapper with fake database clients
and models both rejection before persistence and acknowledgement loss after
successful Discord writes or database COMMIT. Fake roles use a Set. The shared
fixture models transaction-local writes and advisory, row, and unique-key lock
waits for the bot's SQL subset; forced-overlap scenarios live in
`request-pipeline.test.js`. It is not a general PostgreSQL simulator.
Fresh-record guard tests inject intervening state separately from those
concurrency scenarios.

Human review eligibility is unchanged: allowlisted human reviewers in staff
channels, no self-approval, human recipients who completed screening and
onboarding. No automatic approvals, migrations, live-service tests, or live bot
restart are authorized by this change. Process termination between side effects
and recovery remains outside this in-process recovery contract. External manual
Discord role edits do not participate in the database lock.

## Notification retry and recovery policy

- Request creation and its durable audit commit before any notification or
  private success reply. Notification is best effort, not a condition of saving.
- Resubmit the same community via the official menu or `/request` to retry.
  While still pending, the existing ID is reused. Each explicit submission
  produces a request-attempt audit and at most one notification attempt.
- Notifications and audits include the request ID. There is no delivery-state
  table, automatic retry loop, or exactly-once delivery guarantee. A lost send
  acknowledgement can mean a message was delivered; explicit retries may send
  duplicates with the same ID. The reply says “could not be confirmed,” not
  “not delivered.” A restart does not replay notifications.
- Allowlisted humans can use `/pending` and `/review` without a notification.
  Notifications never grant access or approve a request. All notifications and
  private request replies suppress mentions.
- Once denied, a later submission creates a new request. Once approved and the
  role is held, requests for that community are refused as already held.
