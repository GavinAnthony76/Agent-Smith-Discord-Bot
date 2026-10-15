# LMOC TEST six-step onboarding — forensic handoff

## Verdict and scope

**SOURCE IDENTIFIED — SAFE FOR MANNABOT REVIEW**

The implementation is **Agent Smith's standard multi-server platform onboarding
service**, principally
[`apps/agent-smith/src/platform/onboarding.js`](../apps/agent-smith/src/platform/onboarding.js).
The successful run used **LMOC TEST onboarding configuration revision 3** plus
the **roles module at revision 2**, executed through the existing Agent Smith
Gateway and platform runtime. It was not the Hallowed Core native onboarding
state machine and was not executed by the website.

“Safe for review” identifies the source/configuration for a separate port review.
It does **not** certify an unchanged copy as safe to run, establish standalone
MannaBot compatibility, or attest the exact historical deployed binary.

Investigation date: **2026-10-15**. All event times below are **UTC**.
Evidence was obtained from current source, Git history, narrowly scoped
**SELECT-only queries against the managed production replica**, and a filtered
historical deployment-log query. No member IDs, progress-record identifiers,
role/channel/message snowflakes, credentials, sessions or tokens are reproduced.
References such as `COMPLETING_MEMBER` and `COSMETIC_TEST_ROLE` are report aliases.

**No Hallowed Core or LMOC TEST changes, Discord requests, Gateway starts,
workflow restarts, database writes, migrations or publishing were performed.
Only this requested document was created.**

## 1. Implementation owner and provenance

| Candidate | Finding | Evidence |
| --- | --- | --- |
| Agent Smith core/native onboarding | **Not the six-step implementation.** Core hosts the process/client, but its native onboarding is a separate policy. | `src/onboarding.js` defines `smith:onboarding:accept` and `smith:onboarding:join`, with Faith/Gaming/Tech and human-reviewed extras. Platform `context()` explicitly refuses `TARGET_GUILD_ID`. |
| Multi-server platform layer | **Implementation owner.** | `createOnboardingService()` implements `ensure()`, `display()`, `advance()` and `handleInteraction()` and emits the exact `onboarding.step` audit shape. |
| LMOC TEST adapter | **Deployment/configuration/preparation specialization, not a separate six-step engine.** | `activation.js` supplies the allowlist and LMOC identity; `release-config.js` imports the reviewed bundle; `acceptance-resources.js` and `runtime.js` prepare the disposable role and entry. The step interpreter is generic. |
| Website-side configuration | **Editor/control plane, not member-flow execution.** | `components/fields.tsx` edits ordered steps; `components/panels.tsx` saves configuration/publishes an entry through HTTP. Discord interactions execute in the bot runtime. Production onboarding revision 3 came from the reviewed import, not an inferred website edit. |
| Standalone MannaBot | **No matching source is available in this repository for comparison.** | A tracked-filename search for Manna/MannaBot found no files. This report establishes Smith provenance, not a comparison with an external repository. |

### Production evidence that matches the requested run

- `public.platform_modules`: onboarding enabled, **revision 3**, six steps,
  `updated_at=2026-10-09T00:38:30.972Z`.
- `public.platform_records`, collection `onboarding-progress`: the completed
  member's row has **revision 7**, `data.configRevision=3`, `data.step=6`,
  and `data.completedAt=2026-10-09T21:50:55.027Z`.
- This row was created at `21:50:36.111Z`; its last update was `21:50:55.040Z`.
- Rules consent contains
  `{step:1, acceptedAt:"2026-10-09T21:50:42.417Z", configRevision:3}`.
- Exactly six matching step audits, IDs **25, 26, 29, 30, 31, 32**, belong to
  that progress creator. Their last record explicitly has `completed=true`.
- That creator differs from the actor of the guarded Owner publication retry.
  No actual actor identifier was exported to make this comparison.
- Security audit IDs **27–28** record a pending/completed `role.self-select`,
  source `platform-onboarding`, for the same member and the prepared cosmetic
  role. The selected-role value, role allowlist value and prepared resource ID
  compare equal inside the database.
- A separate, earlier **incomplete** progress row reached step index 2 at
  revision 3 around `12:22Z`; its audits **23–24** must not be mixed into the
  completing member's six-event sequence.

The existing `apps/agent-smith/LIVE-ACCEPTANCE.md:11–35` records the same
completion evidence. This investigation independently rechecked the replica;
it did not rely on that narrative alone.

## 2. Actual six-step flow

All six screens are rendered by `display()` in `platform/onboarding.js:133–155`
and dispatched by `handleInteraction():173–233`. Advancement and persistence
are in `advance():156–171`. References in this section are to the current
checkout; historical source identification is in section 7.

Every step is visited in order. The stored configuration has **no per-step
`required` field**. “Required” below describes the interpreter's actual
transition behavior, not an invented configuration setting.

Discord component numbering: **1 = Action Row; 2 = Button; 3 = String Select**.
The configured `ROLE_SELECT` type is implemented using **type 3**, not Discord's
native Role Select component type 6.

| Step / stored index | Configured type and displayed purpose | Actual Discord controls / condition | Persisted result and audit |
| --- | --- | --- | --- |
| **1 / 0** | `MESSAGE`; title **Welcome**; text **Welcome to the community.** | Type-2 primary **Continue** button in a type-1 row. The member must advance this screen. | `data.step` becomes 1; progress revision is expected to advance 1→2. Audit **25**, `21:50:39.875Z`: `{step:0,type:"MESSAGE",completed:false}`. |
| **2 / 1** | `RULES_ACCEPTANCE`; title **Rules**; text **Read and accept the community rules.** | Type-2 **I accept these rules** button. Advancing records consent for this configuration revision. The code does not fetch or snapshot a separate rules document. | `data.step=2`; expected progress revision 3; append the consent object shown above. Audit **26**, `21:50:42.457Z`: `{step:1,type:"RULES_ACCEPTANCE",completed:false}`. |
| **3 / 2** | `ROLE_SELECT`; title **Choose a primary community**; empty content. | Type-3 single-choice string menu from the enabled roles module's **global cosmetic allowlist**, plus type-2 **Continue without a new role**. Visiting the step is required; selecting a role is **optional**. A selected role must pass the guarded self-role service before progress advances. | The observed run has a matching successful cosmetic-role dispatch immediately before audit **29**, `21:50:47.669Z`: `{step:2,type:"ROLE_SELECT",completed:false}`. `data.step=3`; expected revision 4. `selectedRoles` ultimately contains `COSMETIC_TEST_ROLE`. |
| **4 / 3** | `ROLE_SELECT`; title **Choose interests**; empty content. | The **same** global role allowlist/menu and skip button as step 3. There is no step-specific interests list, mutually exclusive framework group, or required role choice. | Audit **30**, `21:50:49.975Z`: `{step:3,type:"ROLE_SELECT",completed:false}`. `data.step=4`; expected revision 5. **The exact branch is not recoverable:** skipping and reselecting the already-held same role can both yield no new role-write audit and the same deduplicated final state. |
| **5 / 4** | `BUTTON`; title **Ready to finish**; text **Continue to finish the LMOC TEST acceptance onboarding.** | Type-2 **Continue** button. `BUTTON` does not select a separate action/plugin or use its title as a custom button label; it is a normal advancement screen. | `data.step=5`; expected revision 6. Audit **31**, `21:50:52.562Z`: `{step:4,type:"BUTTON",completed:false}`. |
| **6 / 5** | `FINALIZATION`; title **Finish**; empty content. | Type-2 **Finish** button. After advancement, no configured step remains and the response is **Onboarding is complete. It does not replace human approval for protected access.**, with no controls. Finalization itself does not grant a role or private access. | `data.step=6`; **observed revision 7**; `completedAt=21:50:55.027Z`. Audit **32**, `21:50:55.069Z`: `{step:5,type:"FINALIZATION",completed:true}`. |

Intermediate progress revisions in the table are the expected results of the
source's one-increment-per-advance algorithm. They are **not individually
stored in the step audit payloads**. The initial row defaults to revision 1,
and the final revision 7 is directly observed.

### Entry, rendering and replay behavior

- Entry is either `/smith-community onboard` or the published type-2
  **Start / resume** button, custom ID `smith:onboarding:start`.
- The completed records do not distinguish which entry method this member used.
- Responses are ephemeral: the handler defers with `flags:64` and edits that
  deferred response. Older component responses can remain visible but stale.
- Screen text is `N/6 · <title>\n<content>`, sanitized by `safeText`.
- Advance component IDs bind **configuration revision, zero-based step index,
  and progress revision**:
  `smith:onboarding:next:3:<index>:<progressRevision>`.
  Role selections use `smith:onboarding:role:3:<index>:<progressRevision>`.
- The server rechecks this token against current member-specific state. Stale
  tokens cause `onboarding_changed_resume_again`, not a silent next-step jump.
- Changed configuration revisions reset progress/consent/selected-role tracking
  under an optimistic revision comparison. That is not a Discord role removal.
- Fresh membership, completed Discord screening (`pending=false`), readable
  channel, verified role state, enabled module and configured entry-channel
  checks precede normal advancement.
- No `QUESTION` occurred in the six-step run. The source supports transient,
  actor-bound question modals, but does not retain their answers.

## 3. Source files and execution chain

Paths in this table are relative to `apps/agent-smith/` unless otherwise noted.

| File / source anchor | Responsibility |
| --- | --- |
| `src/bot.js:61–73,89–95` | Creates the platform using the **existing client and pool**; attaches its HTTP handler; offers interactions to `platform.handleInteraction()` before the core handlers. Do not execute/import this entrypoint during a port review: it connects the bot. |
| `src/platform/runtime.js:32–41,93–112,229–233,282–293` | Builds the generic services; injects live module configuration; requires allowed/active guild dispatch; instantiates onboarding; initializes configuration import, activation and heartbeat. |
| `src/platform/onboarding.js` | Entire member state machine, ephemeral rendering, entry publishing, progress identity, consent, role-selection delegation, finalization, optimistic tokens and audits. |
| `src/platform/activation.js:4–47` | Eight supported standard modules, standard-guild allowlist, exclusion of Hallowed Core, installed/setup checks, runtime-state heartbeat and 90-second liveness window. |
| `src/platform/roles.js:9–49` | Configured cosmetic allowlist, fresh member/bot/permission/hierarchy/private-access checks and idempotent already-assigned return. Both role screens call this same service. |
| `src/platform/role-write.js:7–33` | One-use, scoped role REST dispatch; `role.self-select` security operation with source `platform-onboarding`. |
| `src/privileged-pipeline.js`, `src/platform/transport.js`, `src/platform/discord-access.js` | Guarded mutation/audit pipeline, communication boundary and fresh Discord authority used by the services. Review their transitive security integration before porting; importing the step renderer alone does not reproduce it. |
| `src/platform/release-config.js:6–65` | Reviewed-bundle validation/digest and tightly scoped LMOC configuration import; records `reviewed_configuration_import`. **Do not call it during this forensic review or port it as a general startup migration.** |
| `release/lmoc-config.json:16–25` | Exact committed six-step onboarding revision 3; original roles revision 1 initially had an empty self-assignable list. |
| `src/platform/acceptance-resources.js:68–91` | Owner-only LMOC preparation of the disposable cosmetic role and test resources. |
| `src/platform/runtime.js:43–81` | Preparation action adds the prepared role to the roles configuration, publishes/reuses the onboarding entry, and prepares unrelated ticket/shop fixtures. Not the six-step interpreter. |
| `src/platform/configuration.js:35–96` | Module configuration reads/writes, guild/row locking, optimistic revision increment and before/after configuration audit. |
| `src/platform/service.js:27–39,230–240` | Default onboarding and configured-step validation. **Default has five steps**; the sixth `BUTTON` came from the saved reviewed configuration, not this fallback. |
| `src/platform/http.js:156–163`, `src/platform/commands.js` | Module/action HTTP routing and the guild-local `/smith-community onboard` command definition. |
| `src/platform/schema.sql:3–45,83–90` | Explicit SQL schema for runtime state, guilds, modules, audits and generic records. Not an ORM schema and not a startup migration. |
| `artifacts/smith-platform/src/components/fields.tsx` | Website ordered-step editor (`StepsEditor`), using type/title/content. |
| `artifacts/smith-platform/src/components/panels.tsx` | Website module save and `onboarding-publish` action. Configuration/control surface only. |
| `src/onboarding.js` | **Separate native Hallowed Core implementation**, not the source to use for this six-step handoff. |

Execution chain:

```text
Existing Agent Smith Discord client
  -> bot.js interactionCreate
  -> platform/runtime.js handleInteraction
     [standard allowlist + active runtime]
  -> platform/onboarding.js handleInteraction
  -> context -> ensure -> token/type validation
  -> optional roles.assign -> guarded role dispatch
  -> advance -> platform_records update -> onboarding.step audit
  -> display next step / terminal completion
```

## 4. Exact database model and relationships

All observed tables are in schema **`public`**. The production
`information_schema.columns` and `pg_constraint` results match the relevant
declarations in `src/platform/schema.sql`.

| Table | Relevant columns, keys and role |
| --- | --- |
| `public.platform_guilds` | `guild_id text` PK; `installed boolean`; `policy_key text`; `settings jsonb`; `setup_complete boolean`; `installed_at`, `updated_at timestamptz`. LMOC is installed, setup-complete and `policy_key='standard'`. Settings provide the logical welcome channel reference. |
| `public.platform_modules` | Composite PK `(guild_id,module_key)`; `guild_id` FK to `platform_guilds`; `enabled boolean`; **`configuration_json jsonb`**; **`revision integer`**, positive; `updated_by text`; `updated_at timestamptz`. Onboarding revision and steps live here; companion cosmetic role choices live in the `roles` row. |
| `public.platform_records` | Composite PK `(guild_id,collection,record_id)`; guild FK; `title text`; **`data jsonb`**; **`revision integer DEFAULT 1`**; `created_by text`; `created_at`, `updated_at timestamptz`. Collections distinguish member progress, published entry and prepared resources. |
| `public.platform_audit` | `id bigint GENERATED ALWAYS AS IDENTITY` PK; guild FK; `actor_user_id text`; `action text`; `module text`; `before_state`, `after_state jsonb`; `created_at timestamptz`. Index `(guild_id,created_at DESC,id DESC)` supports guild audit browsing. |
| `public.platform_runtime_state` | `guild_id text` PK; `activated_at`, `last_seen_at timestamptz`; `bot_connected`, `runtime_active boolean`; `module_states jsonb`. Guild association is **logical: no FK exists on this table**. Runtime status, not member progress. |

There is **no `platform_onboarding_progress` table** in the observed production
model. There is no separate platform rules-consent, role-selection or completion
table for this flow. Those facts are JSON fields in `platform_records`.

### Onboarding configuration

`platform_modules(guild_id=LMOC_TEST,module_key='onboarding')`:

- `revision=3`, `enabled=true`;
- `configuration_json.steps`: ordered array of `{type,title,content}`;
- `configuration_json.entryChannelId`: configured entry channel;
- `configuration_json.primaryFrameworks=[]`;
- `configuration_json.humanApprovalForExtras=true`.

The last two fields do not implement framework-group exclusivity or a review
queue in the platform step interpreter.

### Member progress, consent and completion

`platform_records.collection='onboarding-progress'`:

- `record_id` is a deterministic UUID-shaped **text** derived by
  `progressId(guildId,memberId)` from SHA-256 of
  `onboarding:<guildId>:<memberId>`. Do not export this linkable identifier.
- `created_by` binds the row to the Discord member; it is not copied from the
  website's administrator identity.
- Row `revision` is the **progress revision**. It is independent of module
  `revision`, which is the **configuration revision**.
- `data.configRevision` is the logical reference to the onboarding module
  revision. It is **not a separate SQL column or FK**.
- `data.step` is the next zero-based step index.
- `data.consentSteps[]` contains `{step,acceptedAt,configRevision}`.
- `data.selectedRoles[]` contains deduplicated selected role references.
- `data.completedAt` is the completion timestamp.
- The progress JSON does **not** store a `completed=true` boolean.
  That boolean is derived for `platform_audit.after_state.completed`.

Redacted observed completed state:

```json
{
  "collection": "onboarding-progress",
  "revision": 7,
  "member": "COMPLETING_MEMBER",
  "data": {
    "step": 6,
    "configRevision": 3,
    "consentSteps": [
      {"step": 1, "acceptedAt": "2026-10-09T21:50:42.417Z", "configRevision": 3}
    ],
    "selectedRoles": ["COSMETIC_TEST_ROLE"],
    "completedAt": "2026-10-09T21:50:55.027Z"
  }
}
```

### Entry publication and prepared role

- `platform_records(collection='onboarding-entry',record_id='entry:3')`:
  `data={status:"confirmed",channelId:<redacted>,messageId:<redacted>}`.
  Entry row revision is **1**, not onboarding revision 3; `entry:3` embeds the
  module revision. Confirmation was saved at `03:02:33.714Z`.
- `platform_records(collection='acceptance-resource',record_id='resource-role')`:
  title **LMOC TEST disposable cosmetic**, with `data.id` and
  `data.status='confirmed'`. This is the source of the report's
  `COSMETIC_TEST_ROLE` logical reference.
- The stored entry channel equals both onboarding `entryChannelId` and the
  guild's configured welcome-channel setting. `#welcome` is the existing
  acceptance document's logical channel name, not a fresh Discord inspection.

### Runtime state

Observed `activated_at=2026-10-09T00:38:31.686Z`, following configuration import.
At investigation, the replica held `runtime_active=true`, `bot_connected=true`
and all eight supported module flags true, with a later heartbeat on October 15.
This is database-recorded runtime status, **not** a new Gateway probe and not
evidence of the exact build running during the October 9 member action.

Activation refresh occurs about every 20 seconds in the existing process.
Dispatch requires a connected client, an allowlisted standard guild and a
runtime-state heartbeat within 90 seconds.

## 5. Recovered safe configuration and import provenance

The following is a **redacted analysis representation, not an executable
release bundle**. Symbolic references must not be sent to Discord or imported.

```json
{
  "guild": "LMOC_TEST",
  "onboarding": {
    "enabled": true,
    "revision": 3,
    "configuration": {
      "entryChannelId": "WELCOME_CHANNEL",
      "primaryFrameworks": [],
      "humanApprovalForExtras": true,
      "steps": [
        {"type": "MESSAGE", "title": "Welcome", "content": "Welcome to the community."},
        {"type": "RULES_ACCEPTANCE", "title": "Rules", "content": "Read and accept the community rules."},
        {"type": "ROLE_SELECT", "title": "Choose a primary community", "content": ""},
        {"type": "ROLE_SELECT", "title": "Choose interests", "content": ""},
        {"type": "BUTTON", "title": "Ready to finish", "content": "Continue to finish the LMOC TEST acceptance onboarding."},
        {"type": "FINALIZATION", "title": "Finish", "content": ""}
      ]
    }
  },
  "roles": {
    "enabled": true,
    "revision": 2,
    "configuration": {
      "roleGroups": [],
      "protectedRoles": [],
      "rewardableRoles": [],
      "selfAssignableRoles": ["COSMETIC_TEST_ROLE"]
    }
  },
  "logicalReferences": {
    "COSMETIC_TEST_ROLE": "LMOC TEST disposable cosmetic",
    "WELCOME_CHANNEL": "Configured LMOC TEST welcome/entry channel"
  }
}
```

Empty configured `protectedRoles` does **not** remove the code's independent
protected-account, unsafe-name, permission, hierarchy and private-access checks.
The logical role name is recovered from the preparation record/source, not a
fresh assertion of its live Discord display name.

Derived transition semantics: all six positions advance sequentially; rules
acceptance records consent; both role selections are optional choices; the
remaining buttons advance without external actions; the last transition records
completion. No `required`, `optional`, per-step role-group or arbitrary
transition-handler fields were present in this six-step configuration.

### Exact configuration chain

1. `release/lmoc-config.json` contains a reviewed bundle **version 1** with 15
   module configurations, including onboarding revision 3.
2. `configurationDigest()` computes SHA-256 of `JSON.stringify(parsedBundle)`.
   The recomputed committed-bundle digest is:

   ```text
   7142c8ad7810cbf5a58c69d7c52a4ba15227871bf4d4bec2f6255a1291e71ce4
   ```

3. Production audit **1**, `2026-10-09T00:38:30.972Z`,
   `reviewed_configuration_import`, stores **the same digest**, 15 modules,
   and source `reviewed-lmoc-only-configuration`.
4. The current onboarding row still has revision 3 and the same import-time
   update timestamp. Its six ordered types/titles/content match the committed
   bundle when queried directly.
5. The bundle initially contains roles **revision 1**, with no self-assignable
   roles. That file alone is **not** the complete runtime configuration that
   produced the observed cosmetic-role selection.
6. Owner-controlled preparation subsequently configured the disposable cosmetic
   role. Audit **14**, `02:40:13.547Z`, `module_configuration_updated` for
   `roles`, shows the allowlist changing from empty to the current allowlist.
   Production roles are **revision 2**.
7. Initial entry publication was denied: audit **18**, `02:41:08.877Z`,
   `security.denied`, reason `onboarding_entry_not_authorized`.
8. Verified pre-dispatch recovery: audit **19**, `03:02:31.130Z`,
   `onboarding_pre_dispatch_retry`, reason
   `verified_authorization_denial_before_dispatch`, entry `entry:3`.
9. Audits **20–21**, `03:02:31.160Z` and `03:02:33.686Z`, show
   `onboarding.publish` pending/completed, source `platform-onboarding`.
   The entry record became confirmed at `03:02:33.714Z`.
10. The distinct non-owner member completed the six-step run at `21:50:55Z`.

The checksum above was computed from committed non-secret configuration and
compared with an audit field. **No environment-variable or secret value was
read to obtain it.**

## 6. Audit model and evidence limits

### Three relevant audit classes

1. **Configuration provenance**
   - `reviewed_configuration_import`: digest, source, module count.
   - `module_configuration_updated`: before/after enabled state and configuration.
   - The regular configuration-update audit does not itself contain an explicit
     revision-number history; module rows hold the current revision.
2. **Guarded Discord operations**
   - `security.denied`, `security.intent`, `security.result`.
   - Entry publication: operation `onboarding.publish`, source
     `platform-onboarding`.
   - Cosmetic-role addition: operation `role.self-select`, same source.
   - Role intent/result metadata keys observed were
     `role,source,status,target,attempt,guildId,operation`.
     Target/member/role values are deliberately not exported here.
3. **Step advancement**
   - `action='onboarding.step'`, `module='onboarding'`.
   - `actor_user_id` is the member; `after_state` is
     `{step:<old zero-based index>,type:<configured type>,completed:<boolean>}`.
   - Neither the configuration revision, progress revision, selected-role branch,
     nor a configuration snapshot is embedded in each step audit.
     This run can be correlated through the matching member progress row,
     consent revision, unchanged configuration, ordered times and role audits.

### Limits that matter for a port

- One recorded role dispatch proves that role write completed at that time;
  it does not freshly prove the member still holds that role.
- The fourth screen's exact branch cannot be reconstructed because repeated
  selection of an already-held role returns `alreadyAssigned` without a new
  write; `selectedRoles` is deduplicated and skip choices are not separately
  logged.
- Progress is updated with a compare-and-swap revision check, then the step audit
  is inserted in a **separate query**, not a shared transaction.
- A Discord role write happens **before** progress advancement. Discord delivery,
  SQL progress and audit insertion are not one atomic transaction. Do not infer
  exactly-once completion or automatic rollback from the successful normal run.
- The completion evidence does not exercise interrupted resume, stale-click
  refusal, concurrent interactions, role removal, full two-guild acceptance or
  the standalone MannaBot implementation.

## 7. Source version and preservation

| Item | Identified reference / limitation |
| --- | --- |
| Initial platform onboarding source/runtime introduction | `17eb94cf157dae93c5d2366659b278dd205f4000`, **2026-10-08T22:05:44Z**. |
| Reviewed LMOC release bundle and runtime-state schema introduction | `a711413d2f15630c9114156f4e24b3c1ace97ac6`, **2026-10-09T00:13:27Z**. Git history first introduces the committed `Ready to finish` bundle step here. |
| Latest onboarding-service source change before the member completion | `c0afcdc8f05974e7d43f61eeca40818cc6d1100b`, **2026-10-09T02:57:54Z**, publication validation/recovery work. |
| Latest pre-completion Git publish marker | `cb6edbdac24f085650b712f7ecbcb95ecf77c9bb`, **2026-10-09T13:54:59Z**, subject **Published your App**. This is a repository marker, not an independently verified deployed Git SHA. |
| Historical onboarding source blob at that marker | `40d417c40347c8a37b9bdd57af90901dccc4fd27`. |
| Historical and current release-bundle blob | `264b63668c7d0532c07c797c4833c7fd4780090e` at both the publish marker and inspected HEAD. The committed bundle has not been replaced. |
| Member-completion acceptance documentation | `6c8f670971aa14f3d5fc6e08b0c4f2dc4c07eec1`, **2026-10-09T21:54:07Z**. |
| Inspected current source HEAD | `2a52feede0076e8aa9fac02a24d371fdb489a36f`, **2026-10-09T22:55:51Z**, later entitlement work. |
| Current onboarding source blob | `28c46fcfa2f9ec763ff13b62dd792f5a2e3cec8b`. |
| Deployment/build version | Read-only deployment metadata reports a published VM with a successful build, but supplies **no build ID or Git SHA**. A filtered October 9 historical log query returned artifact discovery at `13:54:38.282Z`, not source-version attestation. Package version `1.0.0` is not a unique build identifier. **Exact historical binary/deployment-to-commit binding remains unavailable.** |

`git diff cb6edbd HEAD -- apps/agent-smith/src/platform/onboarding.js` shows
later additions of optional entitlement injection/checks and friendly entitlement
error handling. It does **not** replace `progressId()`, `ensure()`, `display()`,
`advance()`, the six-step interpretation, revision tokens, consent or completion
storage. The roles service similarly gained entitlement checks; the
already-assigned shortcut remains. The reviewed bundle and its importer are
unchanged across that comparison.

Therefore the preserved historical source/configuration is suitable for a
MannaBot **review**, with the binary-version limitation stated above. Do not
claim a runtime-attested exact commit merely because a Git commit says
“Published your App.”

## 8. Runtime dependencies

To understand the historical implementation, review these dependencies without
starting them:

- Existing Node.js/discord.js bot process and **one already-connected Discord
  client**, passed into the platform; no onboarding-specific bot/Gateway.
- PostgreSQL pool and the platform tables in section 4, plus the existing
  security/transport infrastructure that authorizes scoped Discord writes.
- A standard-policy guild that is installed, setup-complete and explicitly
  allowlisted; onboard/roles module configurations loaded from that guild.
- Fresh verified member and bot role/channel state, completed member screening,
  permission/hierarchy checks, and a readable configured onboarding channel.
- Bot Manage Roles for cosmetic-role addition, without Administrator; role
  safety checks and one-use dispatch audit must remain independent of UI labels.
- Configuration-driven role choices; both role steps consult the same roles
  module and only show roles present in the current guild cache, at most 25.
- `platform_runtime_state` liveness maintained by the existing platform process.
- Current source adds optional entitlement-service dependencies that were not
  part of the identified pre-completion onboarding source. They must not be
  confused with the six-step mechanism or with an approved tier matrix.

OAuth, website sessions and configuration HTTP permissions authorize the
administrative editor; members do **not** need website OAuth to use the Discord
onboarding entry or `/smith-community onboard`.

## 9. Safe port considerations and LMOC-specific parts

### Reviewable generic mechanism

The ordered type/title/content interpreter, actor-bound progress identity,
configuration-version consent, optimistic component tokens, explicit finalization
and ephemeral replies are the generic parts to compare with MannaBot.
Any future port needs its own deliberately reviewed data model, namespace,
permission adapter, role policy, audit behavior and Discord client integration.
This document authorizes none of those changes.

### LMOC-specific configuration/preparation

- The LMOC guild allowlist identity and `LMOC_TEST_ID`.
- Reviewed bundle version/digest and its 15-module import.
- The extra fifth-position `BUTTON` with LMOC acceptance wording.
- Entry/welcome channel references and the published entry/message reference.
- Disposable cosmetic role and the preparation-driven roles revision 2.
- Owner-only resource preparation and narrowly classified pre-dispatch retry.
- Disposable ticket category/panel and shop token created by the same preparation
  action: these are **not onboarding-step dependencies** and should not accompany
  a standalone onboarding port.

### What must NOT be copied into standalone MannaBot

1. **Credentials or operational identity:** Smith bot token, OAuth secrets,
   sessions, encrypted tokens, environment values, database connection strings or
   permission to access Smith's production database.
2. **Live identifiers/state:** LMOC/Hallowed Core guild/channel/role/message IDs,
   actual member IDs, progress keys, consent timestamps, completed member records,
   production audit history, or a claim that MannaBot members already consented.
3. **Native Hallowed Core policy by accident:** Faith/Gaming/Tech enrollment,
   protected private-framework access, native human-review queues or core
   onboarding tables. Those are separate from this generic cosmetic flow.
4. **Automatic import/activation side effects:** the LMOC seed bundle/importer,
   its authorization checksum as an installation setting, acceptance-resource
   creation, startup `initialize()` path, command registration, migrations or
   copying/resetting all 15 modules.
5. **A second Gateway or shared entrypoint:** do not import/run `src/bot.js`,
   call `connect()`, start Smith, or construct another production client just to
   reuse the service. A separately authorized MannaBot integration must use its
   own existing lifecycle.
6. **Misinterpreted role semantics:** “primary community” and “interests” are
   labels here, not implemented role groups or exclusive framework rules.
   Do not equate `humanApprovalForExtras=true` with an implemented approval
   workflow, or treat `completedAt` as authorization to protected access.
7. **Partial security:** do not copy `roles.assign()` without its fresh authority,
   screening/hierarchy/privacy checks, protected-role policy, scoped write
   transport and audit integration. Do not weaken those checks to make a port run.
8. **Unreviewed privacy behavior:** no question was used in this run, and the
   optional question handler intentionally discards answers. Do not silently
   start retaining free-form responses, expose them to staff/AI, or invent
   historical answers.
9. **Unproved guarantees:** successful normal completion does not prove atomic
   role/progress/audit updates, replay safety under all races, exactly-once
   delivery, role revocation, portability or complete two-server acceptance.
10. **Commercial policy:** no billing setup, marketing tier restrictions or
    automatic paid plan assignment is part of this handoff.

## 10. Verification and unresolved evidence

This handoff identifies the source through the uniquely matching audit producer,
the current production configuration/progress, the correlated role dispatch, the
exact reviewed-bundle checksum and preserved historical Git blobs.

Remaining evidence limits are explicit:

- No independently attested Git SHA/build identifier for the process handling
  the October 9 interactions.
- No stored entry-method choice or fourth-step skip-versus-reselection branch.
- No fresh Discord inspection of historical/live roles, message labels or ACLs.
- No MannaBot source supplied here to establish compatibility.
- No new member interaction, resume/replay/concurrency test or port execution.

These limitations do not prevent identifying the preserved implementation and
configuration for review; they do prevent claiming an exact-binary attestation,
an exhaustive replay of user choices, or a safe-to-deploy MannaBot migration.

**Final verdict: SOURCE IDENTIFIED — SAFE FOR MANNABOT REVIEW.**
