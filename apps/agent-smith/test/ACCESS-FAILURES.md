# Access failure checks

Run with `pnpm --filter @workspace/agent-smith run test`. The actual
`src/bot.js` interaction listener runs in a closed VM import graph with fake
Discord, configuration, storage, moderation, and native workers. No credentials,
network connections, migrations, or live services are used.

`access-failures.test.js` checks request notification recovery and characterizes
approval failures, including known unsafe outcomes. Passing tests do **not**
mean cross-service approval decisions are atomic.

| Injected failure | Persisted and external outcome | Private reply and retry risk |
| --- | --- | --- |
| Role add rejects before mutation | Request stays pending; no grant, review audit, or new role | Generic private failure is consistent with no approval. A later retry can approve. |
| Grant insert, decision update, audit, or known COMMIT rejection after role add | Database rolls back to pending with no grant or review audit; Discord role remains | Generic private failure omits granted access. Member request retry is refused because the role exists; staff still see a pending review and retry calls role add again. Requires separately approved reconciliation and truthful messaging. |
| Review-channel fetch or send rejects after request commit | Request and durable request audit remain; no access granted; injected failures deliver no notification | Private reply identifies the saved pending request, unconfirmed staff notification, and manual recovery. `/pending` still exposes the request. Explicit retry reuses its pending ID, records another request-attempt audit with that ID, and attempts notification once. |
| Private reply rejects after request commit | Saved pending request, audit, and notification attempt remain | Log identifies the saved request; staff can recover with `/pending`. No generic “Unable to complete” replacement is attempted. |
| Request audit or known COMMIT rejection | Request and audit roll back; no access or notification | Generic private failure remains appropriate; no saved-request claim is made. |

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

Both menu/slash request paths and button/slash approval paths are exercised.
Faults are one-shot and targeted so review notification failures do not also
disable the audit mirror. Database snapshots include only durable records:
rolling back PostgreSQL cannot roll back a Discord role.

Limits: these tests model explicit role-add rejection before mutation and a
known commit rejection before persistence. Lost acknowledgements after a
successful Discord write or database COMMIT remain ambiguous and are not
modeled here. Fake roles use a Set; repeated successful role-add calls do not
create multiple memberships. The fixture is not a concurrency simulator.
These checks use only isolated fakes. They do not connect to Discord, migrate
storage, or change approval compensation or reconciliation.
