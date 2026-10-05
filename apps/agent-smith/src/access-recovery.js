// Recovery must not infer ownership of a pre-existing role or an unacknowledged
// Discord write. All destructive recovery is guarded by fresh locked reads.
export async function recoverApproval({ attempt, error, locked, guild }) {
  const { subject, framework, roleId, requestId, preExisting, added } = attempt;
  const prefix = `Request ${requestId}: `;
  if (error.transactionOutcome !== 'rolled_back') {
    return prefix + 'approval storage outcome is uncertain. Access may be active; no role was removed. Staff reconciliation is required before retrying.';
  }
  if (!preExisting && !added) {
    return prefix + 'approval was not saved, but Discord role-add confirmation is uncertain. Access may be active; no role was removed. Staff reconciliation is required before retrying.';
  }
  try {
    return await locked(`${guild.id}:${subject}`, async db => {
      const request = (await db.query('SELECT * FROM requests WHERE guild_id=$1 AND id=$2', [guild.id, requestId])).rows[0];
      const memberRecord = (await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2 FOR UPDATE', [guild.id, subject])).rows[0];
      const grant = (await db.query('SELECT * FROM grants WHERE guild_id=$1 AND user_id=$2 AND framework=$3', [guild.id, subject, framework])).rows[0];
      if (!request || request.status !== 'pending' || request.user_id !== subject
        || request.framework !== framework || !memberRecord || grant || memberRecord.primary_framework === framework) {
        return prefix + 'the failed approval was not saved, but current records require preserving access. No role was removed. Staff reconciliation is required before retrying.';
      }
      if (preExisting) {
        return prefix + 'approval was not saved. The member’s pre-existing access was preserved. The request remains pending; an allowlisted human can retry the review.';
      }
      const member = await guild.members.fetch({ user: subject, force: true });
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, `Approval ${requestId} rolled back; remove only this attempt’s new role`);
      }
      return prefix + 'approval was not saved. The new role is absent after recovery; the request remains pending. An allowlisted human can retry the review.';
    });
  } catch {
    return prefix + 'approval was not saved, but role recovery could not be confirmed. Access may remain active. Staff reconciliation is required before retrying.';
  }
}
