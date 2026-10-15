# LMOC TEST runtime retirement

Owner instruction recorded 2026-10-15: **Hallowed Core is Agent Smith's sole
active production guild.** LMOC TEST is historical/reference-only. Any future
test guild requires explicit Owner authorization; environment settings or an
existing bot installation do not constitute approval.

## Preserved evidence

The six-step forensic snapshot remains unchanged:
[LMOC six-step onboarding handoff](lmoc-six-step-onboarding-handoff.md).
Its descriptions of enabled modules, heartbeat state and deployment source are
historical observations, not current activation instructions.

Keep `apps/agent-smith/release/lmoc-config.json` unchanged so the recorded digest
and Git provenance remain reproducible. Keep `LIVE-ACCEPTANCE.md` and relevant
source/history. The bundle validator/loader remain useful for source review;
the startup import has been removed and the importer refuses LMOC activation.

No historical guild/module configurations or revisions, member progress,
consents, selected-role records, ticket/economy records, analytics history,
entitlement records or existing audit entries are deleted or reset.

## Effective policy in this source

- Hallowed Core continues through its existing native/legacy adapter, not the
  standard-platform allowlist. Do not put Hallowed Core in that allowlist.
- The reviewed standard-guild authorization set is empty. Stale environment IDs
  cannot reactivate LMOC or authorize an arbitrary replacement guild.
- No LMOC heartbeat timer, module activation, startup command registration,
  welcome/onboarding/AI/economy/leveling handling or analytics collection.
- Dashboard access does not auto-adopt or reinstall LMOC. Authenticated
  historical reads remain available; mutation authorization is refused.
- Runtime status identifies LMOC as `historical-reference-only`, inactive and
  disconnected for that guild, even if an old database heartbeat remains.
  The development status proxy does not relay old active LMOC status.
- The REST security gate refuses non-production guild/channel writes before
  platform mutation adapters; conversation communication scopes also enforce
  guild policy.
- Existing Discord commands/messages/resources are left untouched. Removing
  them, leaving the guild or removing the bot would itself be a Discord write
  and is not performed. Old controls are not handled by the new runtime.

## Non-destructive operational archive

The existing bot's startup invokes `archiveHistoricalRuntime()` using its
existing pool/client identity, with **no second Gateway and no schema migration**.
For an existing LMOC runtime-state row, one atomic SQL statement:

1. Locks the LMOC runtime row.
2. Preserves its previous operational snapshot in a new
   `guild_archived_reference_only` audit entry.
3. Sets `runtime_active=false`, `bot_connected=false`, `module_states={}`.
4. Preserves `activated_at` and `last_seen_at` rather than creating a final
   heartbeat that could be mistaken for activity.

No Hallowed Core row is updated. Subsequent starts do not duplicate the archive
when the row is already deactivated. An audit insertion failure rolls back the
runtime-state update. A missing LMOC runtime row is not manufactured.
Saved `platform_modules.enabled` flags remain historical configuration evidence;
they do not authorize execution.

## Production application boundary

Prepared production settings:

- `PLATFORM_ENABLED_GUILD_IDS=""`
- `PLATFORM_LMOC_CONFIG_SHA256` removed.

**A running published VM does not hot-reload workspace source or these settings.**
The Owner must republish the existing Reserved VM deployment to apply this
change. Do not start the workspace bot, create another Gateway or stop Hallowed
Core as a workaround. Until that release is applied, the previous VM can still
heartbeat or dispatch LMOC; changing settings here is not proof of live removal.

After the Owner republishes, verify through the existing public runtime-status
endpoint that LMOC has `lifecycle="historical-reference-only"`,
`platformEnabled=false`, `runtimeActive=false` and `botConnected=false`.
Use a SELECT-only production query to confirm the archive audit and inactive
runtime row and that `last_seen_at` stops advancing. Do not send test messages,
click historical components or perform cleanup writes in LMOC.

## Verification

- Offline unit suite covers stale allowlists, all standard event/interaction
  entry points, command-registration refusal, dashboard write refusal, skipped
  import, inactive status and blocked REST/conversation writes.
- `node --test test/guild-archive.integration.js` (from `apps/agent-smith`)
  exercises real PostgreSQL in a disposable schema with no `public` fallback:
  evidence preservation, unchanged Hallowed Core, idempotency and atomic rollback
  when the new archive audit cannot be saved.
- Historical positive LMOC resource-preparation and registration fixtures remain
  in source with explicit retirement skips. They are not authority to reactivate
  LMOC. The old explicit multi-guild acceptance runner is likewise retained and
  retired, not silently treated as current authorization. Current negative tests
  replace those activation expectations.
