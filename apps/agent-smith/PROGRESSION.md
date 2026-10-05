# Framework progression

## Ladders

| Level | Cumulative XP | Gaming | Faith | Tech |
|---|---:|---|---|---|
| 1 | 0 | Novice | Initiate | Tech Apprentice |
| 2 | 1,000 | Beginner | Student of the Word | Technician |
| 3 | 3,500 | Skilled | Bible Worker | Tech Pro |
| 4 | 9,000 | Expert | Bible Scholar | Tech Giant |
| 5 | 22,000 | Champion | Disciple of the Word | Tech Lord |
| 6 | 50,000 | Master | Steward of the Word | Lord Digital |
| 7 | 100,000 | Legend | Master of the Word | The One |

XP is independent per framework and never grants membership, moderation powers,
or another community. Eligibility requires recorded primary/human-approved
access, the actual framework and Member roles, and completed Discord screening.
Level 1 begins at approved membership. Role reconciliation removes obsolete
ranks/unlocks, but never erases XP when access is revoked.

Faith levels 1–2 are automatic; levels 3–7 require the threshold and explicit
allowlisted human approval. A pending promotion keeps the approved title.
Approval may explicitly recognize the highest eligible level; it is not granted
by XP alone. Corrections that reduce XP also reduce eligibility.

Faith titles recognize community participation and service, not spiritual worth,
teaching/moderation authority, or unquestionable religious authority. A tracked
shared-hub announcement and `/ranks` explain this.

## Exact earning rates

Central configuration: `src/progression-config.js`.

| Source | XP per verified contribution | Cooldown per member/framework/source | Source maximum/day |
|---|---:|---|---:|
| Correct Gaming trivia | 10 | 10 minutes | 30 XP |
| Helpful answer, human-reviewed | 40 | 60 minutes | 80 XP |
| Verified event participation, human-reviewed | 50 | 4 hours | 100 XP |
| Completed activity, human-reviewed | 30 | 60 minutes | 60 XP |

All sources share **150 earned XP/framework/day**, configurable centrally.
Limits use America/Chicago calendar dates, including DST; timestamps are UTC
instants. Cooldowns do not reset at midnight. The final contribution may receive
partial XP to stay within both caps. A capped/cooldown event is durably consumed;
it cannot be moved to another day to claim the same contribution again.

Approximately 100 XP on an active day could mean an event (50), an activity (30),
and two correct trivia sessions (20). Events/activities must actually qualify;
there is no guaranteed daily/login reward. Levels 2–7 correspond to roughly
10, 35, 90, 220, 500 and 1,000 such active days.

Questions may still be requested once/minute, expire in two minutes, and accept
one answer. Merely issuing commands earns nothing. A verified correct answer is
the trivia contribution. No XP is awarded from messageCreate, bot messages,
idle voice, AI scoring, or activity outside approved frameworks.

Human reviewers verify usefulness, originality/non-repetition, event attendance,
and activity completion. Helpful-answer evidence must be a genuine recipient's
normal message in their private framework, specified by Discord message link or
channelID/messageID. Metadata checks reject bot/webhook/command/system messages,
cross-server/cross-framework evidence, and inaccessible messages. Message text
is not scored or read by the bot; no Message Content Intent is needed.
Activities/events use a stable identifier and a reviewer verification reason.

## Commands

- `/profile`: private XP, current title, next threshold/progress, and pending
  Faith promotions for the caller's currently approved frameworks only.
- `/ranks`: all ladders, rates, limits, and the Faith disclaimer.
- `/xp award user:… framework:… source:… event:… reason:…`: configured owners
  and approvers, in #smith-controls or #access-review only. All earning caps apply.
- `/xp correct user:… framework:… amount:… event:… reason:…`: owners only,
  exceptional signed adjustments, separately audited and not counted as earned
  daily XP. Negative balances are refused. Use a stable correction/ticket ID.
- `/xp status`: private role-job, unconfirmed-announcement and ambiguous-legacy
  counts. It does not publicly expose framework balances.
- `/faith-review pending [after:…]`: private cursor-paginated promotion queue.
- `/faith-review decide id:… approve:… reason:…`: explicit allowlisted human
  review; no self-approval. Already reviewed IDs cannot be replayed.

Manual reasons must explain verification/correction (at least 10 characters in
Discord controls). Reviewers cannot award themselves, including owner
corrections. Reuse the same event ID when retrying: duplicates never add XP.
Actor, recipient, framework, amount, source, reason and outcome are audited.
An unconfirmed storage result is not reported as definite failure.

## Setup, migration and preservation

Explicit development operations (not automatic startup/merge hooks):

```sh
pnpm --filter @workspace/agent-smith run progression:migrate
pnpm --filter @workspace/agent-smith run progression:migrate -- --apply
pnpm --filter @workspace/agent-smith run progression:roles
pnpm --filter @workspace/agent-smith run progression:roles -- --apply
pnpm --filter @workspace/agent-smith run discord:register -- --apply
```

The schema is additive and transactional; original tables/balances are not reset.
Unverified nonzero legacy balances are retained and quarantined for human
reconciliation, never attributed based on current membership. After provenance
is explicitly verified as Gaming/trivia, the migration's
`--verified-gaming-trivia` flag imports once to Gaming only and records the
resolution without deleting the original balance or quarantine history.
The inspected live legacy balances were all zero.

The role operation creates/tracks exactly 21 zero-permission cosmetic ranks
idempotently. It refuses unsafe/missing tracked roles and duplicate names; it
never deletes/replaces existing identities or modifies channel privacy.
Safe untracked exact-name roles may be adopted after permission checks.

## Recovery and unlocks

Durable events, transactions, member/framework advisory locks, unique keys and
fresh membership checks protect XP. Durable revisioned jobs reconcile ranks
after restarts and member/access changes. Discord role failures leave jobs for
safe idempotent retries; rank updates never touch the other framework's ranks.
Native onboarding UI metadata is shared for up to 60 seconds between worker
checks to respect Discord's five-read limit. Actual role permissions and channel
overwrites are freshly checked on each reconciliation; explicit audits read the
native UI directly.

Promotion notices go only to that framework's private lounge, mentioning only
the promoted member. Delivery is claimed durably before sending, with a stable
Discord nonce. Definite pre-delivery failures retry with backoff. Lost send or
storage acknowledgements remain unconfirmed; they are not automatically
reposted. Staff must inspect the durable record and Discord before reconciling.
Exactly-once delivery cannot be guaranteed across Discord and PostgreSQL.

Unlock configuration starts empty; no reward channels are created. Any future
unlock must specify a separate framework-specific `Framework • Unlock: …` role,
the minimum rank, and existing private channels under that framework's category.
The audit rejects cross-framework grants, global/rank-role gates, native rank
self-assignment, base-member gates that bypass rank requirements, and other
role overwrites bypassing the unlock. The service assigns an unlock only when
both recorded/actual membership AND the approved rank qualify; Discord does not
implement a native role-AND condition. Privacy changes require separate approval.

## Tests

```sh
pnpm run bot:test
cd apps/agent-smith
node test/progression-db.test.js --isolated-db
```

The second command deliberately uses a uniquely named disposable PostgreSQL
schema and fake Discord members/channels. It exercises real advisory-lock waits,
shared caps, idempotency, approvals, revocation, migration, role outages, and
lost acknowledgements without altering live members or sending real notices.
The default suite skips that opt-in test; no PostgreSQL test connection is made
unless the explicit flag is supplied.
