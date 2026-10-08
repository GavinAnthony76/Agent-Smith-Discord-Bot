import { randomUUID, createHash } from 'node:crypto';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits as P } from 'discord.js';
import { TARGET_GUILD_ID } from '../config.js';
import { hasPermission } from '../permissions.js';
import { safeText } from '../ai-safety.js';
import { PlatformError, permitScope } from './catalog.js';
import { createSelfRoleService } from './roles.js';
import { withPlatformCommunication } from './transport.js';
import { withPrivilegedPipeline } from '../privileged-pipeline.js';

function progressId(guildId, memberId) {
  const hex = createHash('sha256').update(`onboarding:${guildId}:${memberId}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function createOnboardingService({ client, pool, discord, moduleConfig }) {
  const forms = new Map();
  const roles = createSelfRoleService({ client, pool, discord, moduleConfig });
  async function publish(authority) {
    const scope = permitScope(authority.permit, 'onboarding', true);
    if (scope.guildId === TARGET_GUILD_ID) throw new PlatformError('existing_native_onboarding_retained', 409);
    const settings = await moduleConfig(scope.guildId, 'onboarding');
    if (!settings.enabled || !settings.configuration.entryChannelId || !settings.configuration.steps?.length)
      throw new PlatformError('enabled_onboarding_and_entry_channel_required', 409);
    let guild, channel;
    const message = await withPrivilegedPipeline({
      action: { operation: 'onboarding.publish', source: 'platform-onboarding', guildId: scope.guildId },
      validate: async () => {
        guild = await discord.freshGuild(scope.guildId);
        const actor = await guild.members.fetch({ user: scope.userId, force: true });
        channel = guild.channels.cache.get(settings.configuration.entryChannelId);
        const current = await moduleConfig(scope.guildId, 'onboarding');
        if (!current.enabled || current.revision !== settings.revision || actor.pending !== false ||
            !discord.memberRolesVerified(guild, actor) || !discord.memberRolesVerified(guild, guild.members.me) ||
            !channel || channel.type !== 0 || !hasPermission(actor, P.ViewChannel, channel) ||
            !hasPermission(actor, P.ReadMessageHistory, channel) || !hasPermission(guild.members.me, P.SendMessages, channel))
          throw new PlatformError('onboarding_entry_not_authorized', 403);
      },
      record: (action,data) => pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'onboarding',$4)`,[scope.guildId,scope.userId,action,data]),
    }, () => withPlatformCommunication({ guild, userId: scope.userId, channelId: channel.id }, () => channel.send({
      content: 'Start or resume this server’s configured onboarding. Rules consent and progress are tied to your own account.',
      allowedMentions: { parse: [], repliedUser: false },
      components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: 'smith:onboarding:start', label: 'Start / resume' }] }],
    })));
    return { ok: true, message: `Onboarding entry published in channel ${channel.id} (message ${message.id}).` };
  }
  async function context(interaction) {
    if (!interaction.guildId || interaction.guildId === TARGET_GUILD_ID)
      throw new PlatformError('existing_native_onboarding_retained', 409);
    const guild = await discord.freshGuild(interaction.guildId);
    const member = await guild.members.fetch({ user: interaction.user.id, force: true });
    const channel = guild.channels.cache.get(interaction.channelId);
    if (member.user.bot || member.pending !== false || !discord.memberRolesVerified(guild, member) ||
        !channel || !hasPermission(member, P.ViewChannel, channel) || !hasPermission(member, P.ReadMessageHistory, channel))
      throw new PlatformError('complete_discord_screening_first', 403);
    const settings = await moduleConfig(guild.id, 'onboarding');
    if (!settings.enabled || !settings.configuration.steps?.length)
      throw new PlatformError('onboarding_not_enabled', 409);
    if (settings.configuration.entryChannelId && settings.configuration.entryChannelId !== channel.id)
      throw new PlatformError('use_configured_onboarding_channel', 409);
    return { guild, member, settings, id: progressId(guild.id, member.id) };
  }
  async function ensure(c) {
    await pool.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
      VALUES($1,'onboarding-progress',$2,'Member onboarding',$3,$4) ON CONFLICT DO NOTHING`,
      [c.guild.id, c.id, { step: 0, configRevision: c.settings.revision, consentSteps: [], selectedRoles: [] }, c.member.id]);
    const row = (await pool.query(`SELECT data,revision FROM platform_records WHERE guild_id=$1
      AND collection='onboarding-progress' AND record_id=$2`, [c.guild.id, c.id])).rows[0];
    if (row.data.configRevision !== c.settings.revision) {
      // No inferred historical acceptance: changed configurations restart consent.
      const reset = await pool.query(`UPDATE platform_records SET data=$3,revision=revision+1,updated_at=now()
        WHERE guild_id=$1 AND collection='onboarding-progress' AND record_id=$2 AND revision=$4 RETURNING data,revision`,
        [c.guild.id, c.id, { step: 0, configRevision: c.settings.revision, consentSteps: [], selectedRoles: [] }, row.revision]);
      if (!reset.rows.length) throw new PlatformError('onboarding_changed_resume_again', 409);
      return reset.rows[0];
    }
    return row;
  }
  async function display(c, row) {
    const step = c.settings.configuration.steps[row.data.step];
    if (!step) return { content: 'Onboarding is complete. It does not replace human approval for protected access.', components: [] };
    const index = row.data.step, token = `${c.settings.revision}:${index}:${row.revision}`;
    const components = [];
    if (step.type === 'ROLE_SELECT') {
      const settings = await moduleConfig(c.guild.id, 'roles');
      const choices = settings.enabled ? (settings.configuration.selfAssignableRoles ?? [])
        .filter(id => c.guild.roles.cache.has(id)).slice(0,25) : [];
      if (choices.length) components.push({ type: 1, components: [{ type: 3,
        custom_id: `smith:onboarding:role:${token}`, placeholder: 'Choose one configured self-assignable role',
        min_values: 1, max_values: 1,
        options: choices.map(id => ({ label: safeText(c.guild.roles.cache.get(id).name, 100), value: id })) }] });
    }
    components.push({ type: 1, components: [{ type: 2, style: 1,
      custom_id: `smith:onboarding:next:${token}`,
      label: step.type === 'RULES_ACCEPTANCE' ? 'I accept these rules' :
        step.type === 'QUESTION' ? 'Answer privately' : step.type === 'FINALIZATION' ? 'Finish' :
          step.type === 'ROLE_SELECT' ? 'Continue without a new role' : 'Continue' }] });
    return { content: safeText(`${index+1}/${c.settings.configuration.steps.length} · ${step.title}\n${step.content}` +
      (step.type === 'QUESTION' ? '\nDo not enter passwords, tokens or other secrets. Answers are not retained.' : ''), 1950),
      components };
  }
  async function advance(c, row, roleId) {
    const steps = c.settings.configuration.steps, current = steps[row.data.step];
    if (!current) throw new PlatformError('onboarding_already_complete', 409);
    const data = { ...row.data, step: row.data.step + 1 };
    if (current.type === 'RULES_ACCEPTANCE') data.consentSteps = [...row.data.consentSteps,
      { step: row.data.step, acceptedAt: new Date().toISOString(), configRevision: c.settings.revision }];
    if (roleId) data.selectedRoles = [...new Set([...row.data.selectedRoles, roleId])];
    if (data.step >= steps.length) data.completedAt = new Date().toISOString();
    const result = await pool.query(`UPDATE platform_records SET data=$3,revision=revision+1,updated_at=now()
      WHERE guild_id=$1 AND collection='onboarding-progress' AND record_id=$2 AND revision=$4 RETURNING data,revision`,
      [c.guild.id, c.id, data, row.revision]);
    if (!result.rows.length) throw new PlatformError('onboarding_changed_resume_again', 409);
    await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
      VALUES($1,$2,'onboarding.step','onboarding',$3)`,
      [c.guild.id, c.member.id, { step: row.data.step, type: current.type, completed: !!data.completedAt }]);
    return result.rows[0];
  }
  async function handleInteraction(i) {
    const command = i.isChatInputCommand?.() && i.commandName === 'smith-community' && i.options.getSubcommand() === 'onboard';
    if (!command && (!(i.isButton?.() || i.isStringSelectMenu?.() || i.isModalSubmit?.()) ||
        !i.customId?.startsWith('smith:onboarding:'))) return false;
    try {
      // Modal acknowledgements cannot follow deferReply. Prepare a question
      // modal from the guild-scoped public configuration without REST reads;
      // submission still performs all fresh membership/progress checks below.
      if (i.isButton?.() && i.customId.startsWith('smith:onboarding:next:') &&
          i.guildId && i.guildId !== TARGET_GUILD_ID) {
        const settings = await moduleConfig(i.guildId, 'onboarding');
        const index = Number(i.customId.split(':')[4]), step = settings.configuration.steps?.[index];
        if (settings.enabled && Number.isSafeInteger(index) && step?.type === 'QUESTION') {
          for (const [key,value] of forms) if (value.expires < Date.now()) forms.delete(key);
          if (forms.size >= 1000) throw new PlatformError('onboarding_questions_busy', 429);
          const key = randomUUID(), token = i.customId.split(':').slice(3).join(':');
          forms.set(key, { userId: i.user.id, guildId: i.guildId, token, expires: Date.now()+300000 });
          const modal = new ModalBuilder().setTitle(safeText(step.title,45)).setCustomId(`smith:onboarding:answer:${key}`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer')
              .setLabel('Your answer (not stored)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000)));
          await i.showModal(modal); return true;
        }
      }
      await i.deferReply({ flags: 64 });
      const c = await context(i), row = await ensure(c);
      if (command || i.customId === 'smith:onboarding:start') {
        await i.editReply(await display(c, row)); return true;
      }
      let kind, token, form;
      if (i.isModalSubmit?.()) {
        const key = i.customId.slice('smith:onboarding:answer:'.length);
        form = forms.get(key); forms.delete(key);
        if (!form || form.expires < Date.now() || form.userId !== i.user.id || form.guildId !== i.guildId)
          throw new PlatformError('onboarding_question_expired', 409);
        kind = 'answer'; token = form.token;
        // Only transient acknowledgement is necessary; no answer content is
        // retained in SQL, audit, model context or the form map.
        i.fields.getTextInputValue('answer');
      } else {
        const parts = i.customId.split(':'); kind = parts[2]; token = parts.slice(3).join(':');
      }
      if (token !== `${c.settings.revision}:${row.data.step}:${row.revision}`)
        throw new PlatformError('onboarding_changed_resume_again', 409);
      const step = c.settings.configuration.steps[row.data.step];
      if (!step) throw new PlatformError('onboarding_already_complete', 409);
      if (step.type === 'QUESTION' && kind === 'next') throw new PlatformError('onboarding_question_changed', 409);
      if (!['next','role','answer'].includes(kind) || kind === 'role' && step.type !== 'ROLE_SELECT' ||
          kind === 'answer' && step.type !== 'QUESTION') throw new PlatformError('onboarding_step_action_invalid', 409);
      const roleId = kind === 'role' ? i.values?.[0] : undefined;
      if (kind === 'role' && !roleId) throw new PlatformError('role_selection_required');
      if (roleId) await roles.assign({ guildId: i.guildId, memberId: i.user.id, roleId });
      const next = await advance(c, row, roleId);
      await i.editReply(await display(c, next));
    } catch (error) {
      const content = error instanceof PlatformError ? `Onboarding paused: ${error.code}. Start again to resume.` :
        'Onboarding could not be confirmed. No question answer was retained. Start again to inspect current progress.';
      if (i.deferred || i.replied) await i.editReply({ content, components: [] });
      else await i.reply({ content, flags: 64 });
    }
    return true;
  }
  return { publish, handleInteraction, stop: () => forms.clear() };
}
