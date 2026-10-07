# Hallowed Core / Agent Smith maintenance upgrade

## Delivery status — October 6, 2026 (America/Chicago)

This is a working, additive maintenance upgrade, not a claim that every requested phase is complete. Smith is running in the workspace and the new handlers are registered. Always-on production hosting, scheduled feed integration, guarded channel tools and automatically verified voice participation remain unfinished.

## 1. Architecture inspected

The bot is the Node ES-module application in `apps/agent-smith`, inside the existing pnpm workspace. It uses discord.js 14.25.1 and PostgreSQL through parameterized queries and advisory-locked transactions. Native onboarding, access requests, progression and notification recovery already had durable database state.

The API-server artifact and its template Drizzle setup are unrelated to Smith. They were not repurposed. Drizzle ORM 0.45.1 was added to Smith for persisted interest preferences, using the existing PostgreSQL connections; established transaction and SQL interfaces were retained instead of replacing the database.

The existing native onboarding selection question remains the primary selection signal. A selection signal is not an approval for additional frameworks. Discord permission enforcement and Smith's application-level authorization are separate controls.

## 2. Problems found and changes made

- Lifecycle state, versioned rules acknowledgment, interest intent and activation bookkeeping were incomplete.
- Existing moderation audit intents/results needed structured case history and conservative recovery handling.
- Reports needed private intake, staff controls and persistent protection against duplicate punishment.
- Ordinary moderation and the new aliases needed consistent authorization through the SDK gate.
- Runtime health and reconciliation needed operational controls, not only scripts.
- XP needed an optional nonduplicate text source; optional currency needed transactional accounting.
- Full member chunk requests raced at startup. The new maintenance roster scan uses paginated REST listing rather than another concurrent Gateway member-chunk request.
- Historical framework roles still cannot safely be treated as prior recorded approvals. Ten members remain flagged for manual review.

Smith now periodically reconciles lifecycle/access/interest state, restores recorded approved access on rejoin, restores remaining confirmed timeouts, and persists maintenance heartbeats. It does not automatically decide which historical grants the Owner intended.

## 3. Files changed

New runtime modules:

`authorization.js`, `lifecycle-policy.js`, `maintenance.js`, `maintenance-members.js`, `maintenance-model.js`, `maintenance-cases.js`, `maintenance-reports.js`, `maintenance-ui.js`, `maintenance-commands.js`, `community-economy.js`, `content-automod.js`, `text-participation.js`.

New migration files:

`maintenance-schema.sql`, `maintenance-migrate.js`.

Existing integration files changed:

`bot.js`, `commands.js`, `config.js`, `discord.js`, `migrate.js`, `moderation.js`, `native-policy.js`, `native-reconcile.js`, `request-lifecycle.js`, `review.js`, `security-policy.js`, `security-gate.js`, `smith-control.js`, `progression.js`, `progression-config.js`, `progression-interactions.js`, `progression-worker.js`.

Dependencies/tests changed:

Smith `package.json`, workspace `pnpm-lock.yaml`, `test/helpers/bot-fixture.js`, `test/permissions.test.js`; new `test/maintenance.test.js` and `test/maintenance-postgres.test.js`.

All module paths above are relative to `apps/agent-smith/src` unless otherwise stated.

## 4. Migration and preservation

The additive maintenance migration was applied to the existing workspace database. It adds lifecycle columns, interest preferences, cases/notes, reports/action reservations, worker health, cosmetic economy records, automod observations/actions and text fingerprints. Public table count increased from 18 to 31.

No existing table was dropped or replaced. A digest comparison immediately after migration confirmed original content unchanged in:

- 88 resource records
- 8 member records, excluding the newly added lifecycle metadata
- 2 grants
- 2 requests, excluding new information-request fields
- 59 audit records

Subsequent runtime reconciliation legitimately adds roster records and lifecycle state. The observed roster now contains 19 records: 6 ACTIVE, 10 ONBOARDING_BLOCKED, 2 RULES_PENDING and 1 NEW. These counts are a snapshot, not permanent expected values.

Old real acceptance is labeled `legacy-unversioned`; the migration does not invent a historical acceptance of the new rules version. Missing or ambiguous old moderation results are marked uncertain, not completed. Migration repetition and preservation were tested in an isolated PostgreSQL schema.

Migration commands are development/operator actions, not production startup DDL. Production migration and historical data backfill must be checked separately during publishing; no production database was changed in this work.

## 5. Commands and controls

45 guild commands are now registered, including retained commands and aliases.

Member-facing additions: `/onboarding`, `/interests`, `/report`, `/smith status`, `/balance`, `/daily`, `/shop`, `/buy`, `/inventory`.

Staff additions: `/onboarding-recover`, `/cases`, `/case`, `/case-note`, `/case-close`, `/member-info`, `/mod-history`, `/smith-control panel`.

Aliases: `/warn`, `/warnings`, `/clear-warning`, `/timeout`, `/untimeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/access-request`, `/access-approve`, `/access-deny`, `/access-revoke`.

Owner settings added under `/smith-control`: `rules-version`, `staged-onboarding`, `economy`, `shop-item`, `content-automod`, `text-xp`. Existing request-expiry and passive antispam controls remain.

Pending-request cards now offer “Ask for more info.” Questions stay pending, grant no access, and appear in the applicant's private `/requests` inbox. This is not a new automatic DM-delivery guarantee.

The panel has section navigation and contextual status/command guidance. Channels and feeds are inspection/deferred-operation sections, not implemented channel mutation or feed configuration interfaces.

## 6. Activation defaults and onboarding behavior

No optional feature overrides were enabled in the live database. Staged onboarding, content automod, text XP and the cosmetic economy are off by default.

The existing native flow remains active: screening and exactly one valid community selection permit normal native reconciliation. Existing members are not retroactively moved into a new staged flow.

The staged option applies to new records after the Owner explicitly enables it. It requires an existing tracked, permission-free `NEW ARRIVAL` role below Smith, without channel access grants. Enabling the setting validates/adopts that role but does not create it.

Assigning any role while a member is still pending can bypass Discord-native screening. Therefore Smith intentionally does NOT assign NEW ARRIVAL before native screening completes. After screening, staged members may receive that cosmetic arrival role while completing additional steps.

Staged activation requires explicit current-version acknowledgment, a persisted primary framework, and Finish interests. Finish may select no optional interests. Activation grants Member plus the allowed framework roles, records activation and removes NEW ARRIVAL.

Only the primary framework and human-approved additional grants authorize access. Reviewed authoritative records permit removal of unexplained extra frameworks; uncertain/pending access decisions block blind cleanup. Historical unreviewed access is preserved for manual review.

Recovery is deliberately reconcile-only. It does not erase the primary framework, fabricate approvals, clear punishment or reset security history.

## 7. Moderation, reports and logging

Owner/protected-account immunity, hierarchy checks, bot-specific permissions, protected-channel rules and bounded destructive confirmation remain enforced.

Admin/Moderator accounts can perform supported ordinary moderation subject to permissions/hierarchy. Kick, ban, unban and purge remain Owner-only. No Administrator permission is requested for Smith.

Warnings and punishment intent/results are linked to durable cases. Notes and closing paperwork do not delete history or clear punishment. Warning withdrawal updates both audit history and structured warning state.

Rejoin recovery reapplies only the remaining duration of a confirmed, unexpired timeout. It uses the original human actor and the same SDK checks. Lost permissions/hierarchy produce a blocked recovery record rather than an unsafe bypass. Smith does not automatically re-ban rejoining members.

Reports are private. Staff may claim, warn, timeout, escalate, dismiss or close. Punishment requires a reason and a durable action reservation; duplicate or uncertain actions cannot simply be repeated. Report cards may be redelivered after an acknowledgment failure, but action reservations prevent repeated punishment.

Join/leave, nickname/role metadata, channel/role create-update-delete, and message edit/delete metadata are audited. Raw message text is not stored by the new content/XP pipelines. Not every metadata event has a durable Discord-channel delivery outbox. Manual moderation outside Smith and automatic audit-log ingestion are not fully tracked.

## 8. Automod, XP and economy

Optional deterministic content rules cover external invites, blocked terms/domains, mass mentions, message flooding, duplicates, emoji flooding, caps flooding and scam patterns. Configured actions: LOG, DELETE, WARN, TIMEOUT, ESCALATE. No AI classifies or executes moderation.

Rules use bounded literal lists, not user regex. Channel exclusions are configurable. Content settings refresh within approximately 30 seconds. Automatic actions require explicit current Owner configuration and still use the normal permissions, immunity, hierarchy and destructive-rate safeguards. Known/uncertain attempts are recorded rather than blindly retried.

Optional text XP applies only to approved framework categories and ACTIVE membership. Tiny posts, commands, repeated characters, known scam/caps patterns and duplicate fingerprints are rejected. Text rewards are 5 XP, a 60-second cooldown and a 60-XP source daily cap, alongside existing progression limits. No raw content is persisted.

Existing verified participation/trivia sources remain. Automatic voice XP is NOT implemented: membership in a voice channel alone would reward idle farming, and reliable speaking/activity evidence was not added. Expiring Discord reward roles are not implemented.

The optional economy uses cosmetic credits only: 10 daily credits per America/Chicago calendar day, transaction keys, per-member locks, nonnegative balances, shop/inventory and immutable transaction history. Purchases are cosmetic inventory badges, never framework, staff or other security roles. They are visible through inventory, not a new graphical profile system.

## 9. Intents, permissions and Owner setup

Current Gateway intents: Guilds, GuildMembers, GuildMessages. Message/Channel partials support metadata events. MessageContent is requested only when `SMITH_ENABLE_MESSAGE_CONTENT=true`.

To enable content automod or text XP, enable Message Content in Discord Developer Portal, set that runtime flag through environment configuration, restart Smith, and then explicitly enable the feature in `/smith-control`. The implementation does not silently request a privileged intent.

Guild Members intent must remain enabled. Voice States, Presence and moderation-audit-log intents were not added.

Required ordinary bot access remains View Channel, Send Messages, Read Message History and Manage Roles for permitted roles. Manage Roles belongs on the bot guild role, not channel creation overwrites. Timeouts require Moderate Members; purge/delete requires Manage Messages in the target channel; kick/ban operations require their specific permissions. Missing powers cause refusal. No role permission or hierarchy changes were applied automatically.

For staged onboarding, manually create the permission-free NEW ARRIVAL role below Smith, verify native screening/community selection, set the rules version, and explicitly enable staged onboarding with that role. Keep the native required community question single-select.

For the economy, explicitly enable it and configure cosmetic shop items. No real-money checkout or payment integration exists.

System-notice destination remains the Owner's #bot-spam choice. The reviewed extra Send Messages denial on community-help is retained.

## 10. Verification and audit results

Final automated run: 311 tests total; 310 passed, 0 failed, 1 skipped. The skipped test is the pre-existing isolated PostgreSQL progression suite, not a claimed passing test.

The maintenance PostgreSQL integration group ran against a randomly isolated schema, never real Discord members, and cleaned up only that test schema. It covered repeatable migration, version acknowledgment, staged finish, interest intent recovery, rejoin access restoration, confirmed timeout expiry restoration, case notes/closing, report reservations and economy transactions.

The daily-credit concurrency test held one transaction open and observed the second waiting on a real PostgreSQL advisory lock before release. That is stronger than two sequential calls.

Static privileged-transport, permission-resolver and AI-boundary checks passed.

Live Discord permission audit: reviewed permission overwrites remain consistent, including the approved community-help restriction. Audit exits nonzero for 10 unrecorded historical framework-access members. This audit is NOT reported as fully passed; Owner review is required. No historical roles were removed to force a pass.

Command registration succeeded. Final runtime logged “Agent Smith ready.” Maintenance heartbeat showed queue 0 and failures 0 after the roster fix. This establishes current workspace operation, not production uptime or successful human interaction with every new command.

No real Discord-member UI journey was driven automatically. The manual checks below are still required.

## 11. Exact new-member walkthrough and manual validation

Current native mode:

1. Invite a fresh human account and complete Discord-native rules screening.
2. Select exactly one of FAITH / GAMING / TECH in Channels & Roles.
3. Let native reconciliation persist acceptance/primary and grant Member plus that framework. Selecting another signal must never automatically approve crossover.
4. Open `/onboarding` for recorded state and a link to the current rules.
5. Use `/interests` to choose only interests offered for approved frameworks. Confirm selections/Finish and verify they survive a restart.
6. Use the access-request menu or `/access-request` for an additional framework; verify no extra access is granted while pending.
7. Have a different authorized human approve, deny or ask for more information in the control room. Read the applicant's `/requests` inbox.

Owner-enabled staged mode, for a genuinely new record:

1. Finish native screening first; verify no bot role bypasses screening.
2. Choose exactly one native community signal.
3. Open `/onboarding`, read the linked rules and click “I Agree.” Smith records the current version and queues native primary reconciliation.
4. Reopen/refresh onboarding; verify one persisted primary and no Member/framework activation yet.
5. Use `/interests`, choose appropriate optional interests or none, then Finish interests.
6. Verify ACTIVE, recorded activation, Member + primary, NEW ARRIVAL removed, and no unapproved extra framework.
7. Repeat the buttons; restart; leave/rejoin. Verify stable primary, saved interests, no duplicate approvals, and restoration of only approved access.

Staff checks:

- Submit a report from a normal account; confirm private staff-only visibility and persistence.
- Claim and warn/timeout with a reason; double-click/reopen the action and verify no repeated punishment.
- Simulate missing bot permission, lost actor hierarchy and closed DMs; verify safe refusals and retained audit/report state.
- Leave/rejoin with a confirmed timeout; verify only its remaining duration is restored.
- Try Owner/protected targets through commands, buttons and modals; every management/punishment attempt must be refused.
- Exercise member versus staff status/panel access; ordinary members must not see private case/report data.
- If enabling optional content/credits, test exclusions, duplicate messages, cooldowns, daily rewards and simultaneous purchases with non-Owner accounts.

## 12. Remaining risks and deferred scope

- No production deployment was created. The selected Reserved VM preparation still needs an approved worker publishing configuration and a single-Gateway cutover. Workspace operation is not 24/7 hosting.
- Ten historical-access members need actual human provenance review. Native choices or existing role presence must not be used to fabricate earlier approvals.
- Feeds retain the pre-existing manual polling/configuration path. Database-backed source management, integrated persistent scheduling, robust delivery recovery and automatic discussion threads were not completed.
- Slowmode, channel lock/unlock, safe create/rename/delete and staff channel-management UI are not implemented. SDK structural writes remain blocked; manual Owner action is required.
- Automatic verified voice XP, temporary reward-role expiry, full configurable logging retention/delivery, permission-repair controls, manual-moderation ingestion and complete rich control-panel actions remain deferred.
- Native interest-question self-assignments are not a full synchronized replacement for the new PostgreSQL preference UI. The filtered bot picker is the persisted path; native cosmetics must not be confused with framework approvals.
- Uncertain external writes intentionally favor preservation and staff reconciliation. They do not provide a mathematical exactly-once Discord delivery guarantee.
- Always-on/sharding/Redis scaling was not introduced. Current operation is the existing single bot process with database-backed durable business state and transient retry queues.

Do not treat deferred capabilities, dormant optional features or the manual checklist as completed live validation.
