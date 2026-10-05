# Access failure checks

Run with `pnpm --filter @workspace/agent-smith run test`. The actual
`src/bot.js` interaction listener runs in a closed VM import graph with fake
Discord, configuration, storage, moderation, and native workers. No credentials,
network connections, migrations, or live services are used.

`access-failures.test.js` characterizes current behavior, including known unsafe
outcomes. Passing tests do **not** mean cross-service decisions are atomic or
that the current private errors accurately explain partial success.

| Injected failure | Persisted and external outcome | Private reply and retry risk |
| --- | --- | --- |
| Role add rejects before mutation | Request stays pending; no grant, review audit, or new role | Generic private failure is consistent with no approval. A later retry can approve. |
| Grant insert, decision update, audit, or known COMMIT rejection after role add | Database rolls back to pending with no grant or review audit; Discord role remains | Generic private failure omits granted access. Member request retry is refused because the role exists; staff still see a pending review and retry calls role add again. Requires separately approved reconciliation and truthful messaging. |
| Review-channel fetch or send rejects after request commit | Request and durable request audit remain; no access granted; no staff notification delivered | Initial private success is overwritten with “Unable to complete.” `/pending` still exposes the request. Retry reuses its ID but adds another audit and attempts notification again. Requires separately approved post-commit delivery handling and truthful messaging. |

Both menu/slash request paths and button/slash approval paths are exercised.
Faults are one-shot and targeted so review notification failures do not also
disable the audit mirror. Database snapshots include only durable records:
rolling back PostgreSQL cannot roll back a Discord role.

Limits: these tests model explicit role-add rejection before mutation and a
known commit rejection before persistence. Lost acknowledgements after a
successful Discord write or database COMMIT remain ambiguous and are not
modeled here. Fake roles use a Set; repeated successful role-add calls do not
create multiple memberships. The fixture is not a concurrency simulator.
No production policy, compensation, reconciliation, or notification retry
implementation is changed by these tests.
