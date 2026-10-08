import { randomUUID } from 'node:crypto';
import { Routes, PermissionFlagsBits as P, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { PlatformError, permitScope } from './catalog.js';
import { TARGET_GUILD_ID } from '../config.js';
import { hasPermission } from '../permissions.js';
import { safeText, splitDiscord } from '../ai-safety.js';
import { withTicketWrite } from './ticket-write.js';

const live = new Set(['open', 'claimed', 'escalated']);
const read = P.ViewChannel | P.ReadMessageHistory;
const talk = read | P.SendMessages | P.AttachFiles | P.EmbedLinks;

export function ticketOverwrites(guild, creatorId, supportRoles, closed = false) {
  const rows = [
    { id: guild.id, type: 0, allow: '0', deny: P.ViewChannel.toString() },
    { id: guild.members.me.id, type: 1, allow: talk.toString(), deny: '0' },
  ];
  for (const [id, type] of [[creatorId, 1], ...supportRoles.map(id => [id, 0])]) {
    if (rows.some(row => row.id === id)) continue;
    rows.push({ id, type, allow: (closed ? read : talk).toString(),
      deny: (closed ? P.SendMessages : 0n).toString() });
  }
  return rows;
}

export function createTicketService({ client, pool, discord }) {
  const forms = new Map();
  async function audit(guildId, actorId, action, data) {
    await pool.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
      VALUES($1,$2,$3,'tickets',$4)`, [guildId, actorId, action, data]);
  }
  async function panel(guildId, panelId) {
    const row = (await pool.query(`SELECT record_id,title,data,revision FROM platform_records
      WHERE guild_id=$1 AND collection='ticket-panels' AND record_id=$2`, [guildId, panelId])).rows[0];
    const enabled = (await pool.query(`SELECT enabled FROM platform_modules
      WHERE guild_id=$1 AND module_key='tickets'`, [guildId])).rows[0]?.enabled;
    if (!row || !enabled || row.data.enabled !== true) throw new PlatformError('ticket_panel_unavailable', 409);
    return row;
  }
  async function fresh(guildId, actorId) {
    if (guildId === TARGET_GUILD_ID) throw new PlatformError('hallowed_core_ticket_activation_requires_policy_review', 409);
    const guild = await discord.freshGuild(guildId);
    const actor = await guild.members.fetch({ user: actorId, force: true });
    if (actor.pending !== false || actor.user.bot || !discord.memberRolesVerified(guild, actor) ||
        !discord.memberRolesVerified(guild, guild.members.me)) throw new PlatformError('ticket_member_not_eligible', 403);
    if (!hasPermission(guild.members.me, P.ManageChannels)) throw new PlatformError('ticket_manage_channels_permission_required', 409);
    if (hasPermission(guild.members.me, P.Administrator)) throw new PlatformError('ticket_bot_administrator_not_allowed', 409);
    return { guild, actor };
  }
  async function write({ guildId, actorId, operation, channelId, method = 'POST', body, validate }) {
    const route = operation === 'ticket.create' ? Routes.guildChannels(guildId) :
      operation === 'ticket.close' ? Routes.channel(channelId) : Routes.channelMessages(channelId);
    return withTicketWrite({ client, guildId, actorId, operation, channelId, method, route, body,
      validate, record: (event, data) => audit(guildId, actorId, event, data),
    }, () => method === 'PATCH' ? client.rest.patch(route, { body }) : client.rest.post(route, { body }));
  }
  async function privateChannel(guildId, actorId, ticketId, channelId) {
    const current = await fresh(guildId, actorId), channel = await current.guild.channels.fetch(channelId, { force: true });
    const everyone = channel?.permissionOverwrites.cache.get(guildId);
    if (!channel || channel.topic !== `smith-ticket:${ticketId}` ||
        !everyone?.deny.has(P.ViewChannel) || everyone.allow.has(P.ViewChannel) ||
        !hasPermission(current.actor, P.ViewChannel, channel) ||
        !hasPermission(current.actor, P.ReadMessageHistory, channel)) {
      throw new PlatformError('ticket_private_channel_not_authorized', 403);
    }
    return { ...current, channel };
  }
  async function publish(authority, panelId) {
    const scope = permitScope(authority.permit, 'tickets', true);
    if (!['OWNER', 'ADMIN'].includes(scope.role)) throw new PlatformError('ticket_panel_manager_required', 403);
    const item = await panel(scope.guildId, panelId);
    const channelId = item.data.publishChannelId;
    const validate = async () => {
      const { guild, actor } = await fresh(scope.guildId, scope.userId);
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.isThread?.() || channel.type !== 0 ||
          !hasPermission(actor, P.ViewChannel, channel) || !hasPermission(actor, P.ManageChannels) ||
          !hasPermission(guild.members.me, P.ViewChannel, channel) ||
          !hasPermission(guild.members.me, P.SendMessages, channel)) throw new PlatformError('ticket_panel_channel_not_authorized', 403);
      const category = guild.channels.cache.get(item.data.categoryId);
      if (!category || category.type !== 4 || !hasPermission(guild.members.me, P.ViewChannel, category) ||
          !hasPermission(guild.members.me, P.ManageChannels, category)) throw new PlatformError('ticket_category_required');
    };
    const message = await write({ guildId: scope.guildId, actorId: scope.userId, operation: 'ticket.panel', channelId,
      body: { content: safeText(`${item.title}\n${item.data.description ?? ''}`, 1900),
        allowed_mentions: { parse: [] },
        components: [{ type: 1, components: [{ type: 2, style: 1,
          custom_id: `smith:ticket:open:${panelId}`, label: safeText(item.data.buttonLabel || 'Open ticket', 80) }] }] },
      validate });
    const result = await pool.query(`UPDATE platform_records SET data=data||$4::jsonb,revision=revision+1,updated_at=now()
      WHERE guild_id=$1 AND collection='ticket-panels' AND record_id=$2 AND revision=$3 RETURNING revision`,
      [scope.guildId, panelId, item.revision, { publishedChannelId: channelId,
        publishedMessageId: message.id, publishedRevision: item.revision + 1 }]);
    if (!result.rows.length) throw new PlatformError('ticket_panel_changed_republish_required', 409);
    return { ok: true, message: 'Ticket panel published. Earlier or changed panels cannot open new tickets.' };
  }
  async function open({ guildId, actorId, panelId, channelId, messageId, answers = [] }) {
    const item = await panel(guildId, panelId);
    if (item.data.publishedRevision !== item.revision || item.data.publishedChannelId !== channelId ||
        item.data.publishedMessageId !== messageId) throw new PlatformError('ticket_panel_changed_republish_required', 409);
    const { guild, actor } = await fresh(guildId, actorId);
    const source = guild.channels.cache.get(channelId), category = guild.channels.cache.get(item.data.categoryId);
    if (!source || !hasPermission(actor, P.ViewChannel, source) || !category || category.type !== 4) {
      throw new PlatformError('ticket_source_not_authorized', 403);
    }
    const supportRoles = item.data.supportRoles ?? [];
    if (supportRoles.some(id => id === guildId || !guild.roles.cache.has(id))) throw new PlatformError('ticket_support_roles_invalid');
    const ticketId = randomUUID();
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const reserved = await db.query(`INSERT INTO platform_ticket_channels(guild_id,ticket_id,creator_id,panel_id)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING ticket_id`, [guildId, ticketId, actorId, panelId]);
      if (!reserved.rows.length) throw new PlatformError('ticket_already_open_or_awaiting_reconciliation', 409);
      await db.query(`INSERT INTO platform_records(guild_id,collection,record_id,title,data,created_by)
        VALUES($1,'ticket-acl',$2,'Private ticket access snapshot',$3,$4)`,
        [guildId, ticketId, { supportRoles, categoryId: category.id }, actorId]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
    let channel;
    try {
      channel = await write({ guildId, actorId, operation: 'ticket.create',
        body: { name: `ticket-${ticketId.slice(0, 8)}`, type: 0, parent_id: category.id,
          topic: `smith-ticket:${ticketId}`, permission_overwrites: ticketOverwrites(guild, actorId, supportRoles) },
        validate: async () => {
          const current = await fresh(guildId, actorId);
          const currentPanel = await panel(guildId, panelId);
          if (currentPanel.revision !== item.revision ||
              !hasPermission(current.actor, P.ViewChannel, current.guild.channels.cache.get(channelId))) {
            throw new PlatformError('ticket_authority_changed', 409);
          }
        } });
      const channels = await guild.channels.fetch();
      const matches = [...channels.values()].filter(c => c.topic === `smith-ticket:${ticketId}`);
      if (matches.length !== 1 || matches[0].id !== channel.id) throw new PlatformError('ticket_creation_requires_reconciliation', 409);
      await pool.query(`UPDATE platform_ticket_channels SET channel_id=$3,status='open'
        WHERE guild_id=$1 AND ticket_id=$2 AND status='creating'`, [guildId, ticketId, channel.id]);
    } catch (error) {
      await pool.query(`UPDATE platform_ticket_channels SET status='uncertain',channel_id=COALESCE($3,channel_id)
        WHERE guild_id=$1 AND ticket_id=$2`, [guildId, ticketId, channel?.id ?? null]);
      throw error;
    }
    // Answers are private channel content, never retained in SQL or audit details.
    try {
      for (const content of splitDiscord(`Ticket ${ticketId} · ${item.data.ticketType || 'Support'}\n${item.title}\n${answers.map(answer =>
        `${safeText(answer.label, 45)}: ${safeText(answer.value, 1000)}`).join('\n')}`)) {
        await write({ guildId, actorId, operation: 'ticket.message', channelId: channel.id,
          body: { content, allowed_mentions: { parse: [] } },
          validate: async () => { await privateChannel(guildId, actorId, ticketId, channel.id); } });
      }
    } catch {
      await audit(guildId, actorId, 'ticket.intake_delivery_unconfirmed', { ticketId, channelId: channel.id });
      return { ticketId, channelId: channel.id, intakeDelivered: false };
    }
    return { ticketId, channelId: channel.id, intakeDelivered: true };
  }
  async function staffAction(authority, input) {
    const scope = permitScope(authority.permit, 'tickets', true);
    if (input.action === 'ticket-publish') return publish(authority, input.target);
    if (input.action === 'ticket-reconcile') {
      if (scope.role !== 'OWNER' || input.confirmed !== true) throw new PlatformError('owner_confirmation_required', 403);
      const row = (await pool.query(`SELECT * FROM platform_ticket_channels
        WHERE guild_id=$1 AND ticket_id=$2 AND status='uncertain'`, [scope.guildId, input.target])).rows[0];
      if (!row) throw new PlatformError('ticket_not_awaiting_reconciliation', 409);
      const lease = (await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1
        AND collection='ticket-acl' AND record_id=$2`, [scope.guildId, row.ticket_id])).rows[0]?.data;
      if (lease?.closeInFlight && input.note !== 'CONFIRM_EXECUTOR_STOPPED') {
        throw new PlatformError('stop_and_review_ticket_executor_before_reconciliation', 409);
      }
      const { guild, actor } = await fresh(scope.guildId, scope.userId);
      const matches = [...(await guild.channels.fetch()).values()].filter(c =>
        c.topic === `smith-ticket:${row.ticket_id}` && c.name === `ticket-${row.ticket_id.slice(0, 8)}`);
      if (matches.length !== 1) throw new PlatformError('ticket_requires_manual_discord_inspection', 409);
      const channel = matches[0], everyone = channel.permissionOverwrites.cache.get(scope.guildId);
      if (!everyone?.deny.has(P.ViewChannel) || everyone.allow.has(P.ViewChannel) ||
          !hasPermission(actor, P.ViewChannel, channel)) throw new PlatformError('ticket_channel_privacy_not_verified', 403);
      const closed = channel.permissionOverwrites.cache.get(row.creator_id)?.deny.has(P.SendMessages);
      const status = closed ? 'closed' : row.claimed_by ? 'claimed' : 'open';
      const reconciled = await pool.query(`UPDATE platform_ticket_channels SET channel_id=$3,status=$4,
        closed_at=CASE WHEN $4='closed' THEN now() ELSE NULL END
        WHERE guild_id=$1 AND ticket_id=$2 AND status='uncertain' RETURNING ticket_id`, [scope.guildId, row.ticket_id, channel.id, status]);
      if (!reconciled.rows.length) throw new PlatformError('ticket_state_changed', 409);
      await pool.query(`UPDATE platform_records SET data=data-'closeInFlight' WHERE guild_id=$1
        AND collection='ticket-acl' AND record_id=$2`, [scope.guildId, row.ticket_id]);
      await audit(scope.guildId, scope.userId, 'ticket.reconciled', { ticketId: row.ticket_id, channelId: channel.id, status });
      return { ok: true, message: 'Unique private ticket reconciled from live Discord state. No Discord write or resend was performed.' };
    }
    if (!['ticket-claim', 'ticket-escalate', 'ticket-close'].includes(input.action)) throw new PlatformError('unsupported_ticket_action');
    if (input.action === 'ticket-close' && input.confirmed !== true) throw new PlatformError('confirmation_required');
    const db = await pool.connect();
    let row, claimed = false;
    try {
      await db.query('BEGIN');
      row = (await db.query(`SELECT * FROM platform_ticket_channels WHERE guild_id=$1 AND ticket_id=$2 FOR UPDATE`,
        [scope.guildId, input.target])).rows[0];
      if (!row || !live.has(row.status)) throw new PlatformError('ticket_not_open', 409);
      const { guild, actor } = await fresh(scope.guildId, scope.userId);
      const channel = await guild.channels.fetch(row.channel_id);
      if (!channel || channel.topic !== `smith-ticket:${row.ticket_id}` ||
          !hasPermission(actor, P.ViewChannel, channel) || !hasPermission(actor, P.ReadMessageHistory, channel)) {
        throw new PlatformError('ticket_staff_not_authorized', 403);
      }
      if (input.action === 'ticket-claim' && row.claimed_by && row.claimed_by !== scope.userId) throw new PlatformError('ticket_already_claimed', 409);
      const status = input.action === 'ticket-claim' ? 'claimed' : input.action === 'ticket-escalate' ? 'escalated' : 'uncertain';
      if (input.action === 'ticket-close') {
        const marked = await db.query(`UPDATE platform_records SET data=data||'{"closeInFlight":true}'::jsonb
          WHERE guild_id=$1 AND collection='ticket-acl' AND record_id=$2 RETURNING record_id`,
          [scope.guildId, row.ticket_id]);
        if (!marked.rows.length) throw new PlatformError('ticket_access_snapshot_unavailable', 409);
      }
      await db.query(`UPDATE platform_ticket_channels SET status=$3,claimed_by=CASE WHEN $3='claimed' THEN $4 ELSE claimed_by END
        WHERE guild_id=$1 AND ticket_id=$2`, [scope.guildId, row.ticket_id, status, scope.userId]);
      await db.query(`INSERT INTO platform_audit(guild_id,actor_user_id,action,module,after_state)
        VALUES($1,$2,$3,'tickets',$4)`, [scope.guildId, scope.userId, input.action, { ticketId: row.ticket_id, status }]);
      await db.query('COMMIT'); claimed = true;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
    if (input.action === 'ticket-close' && claimed) {
      try {
      const acl = (await pool.query(`SELECT data FROM platform_records WHERE guild_id=$1 AND collection='ticket-acl'
        AND record_id=$2`, [scope.guildId, row.ticket_id])).rows[0]?.data;
      if (!acl) throw new PlatformError('ticket_access_snapshot_unavailable', 409);
      const { guild } = await fresh(scope.guildId, scope.userId);
      await write({ guildId: scope.guildId, actorId: scope.userId, operation: 'ticket.close',
        channelId: row.channel_id, method: 'PATCH',
        body: { permission_overwrites: ticketOverwrites(guild, row.creator_id,
          acl.supportRoles.filter(id => guild.roles.cache.has(id)), true) },
        validate: async () => {
          await privateChannel(scope.guildId, scope.userId, row.ticket_id, row.channel_id);
        } });
      await pool.query(`UPDATE platform_ticket_channels SET status='closed',closed_at=now()
        WHERE guild_id=$1 AND ticket_id=$2 AND status='uncertain'`, [scope.guildId, row.ticket_id]);
      await audit(scope.guildId, scope.userId, 'ticket.closed', { ticketId: row.ticket_id, transcriptChannelId: row.channel_id });
      } finally {
        await pool.query(`UPDATE platform_records SET data=data-'closeInFlight' WHERE guild_id=$1
          AND collection='ticket-acl' AND record_id=$2`, [scope.guildId, row.ticket_id]);
      }
    }
    return { ok: true, message: input.action === 'ticket-close' ?
      'Ticket closed; its private channel remains available for authorized transcript review.' : 'Ticket status updated.' };
  }
  async function handleInteraction(interaction) {
    const button = interaction.isButton?.() && interaction.customId.startsWith('smith:ticket:open:');
    const modal = interaction.isModalSubmit?.() && interaction.customId.startsWith('smith:ticket:form:');
    if (!button && !modal) return false;
    try {
      let args;
      if (button) {
        const panelId = interaction.customId.slice('smith:ticket:open:'.length), item = await panel(interaction.guildId, panelId);
        args = { guildId: interaction.guildId, actorId: interaction.user.id, panelId,
          channelId: interaction.channelId, messageId: interaction.message.id };
        const current = await fresh(args.guildId, args.actorId), source = current.guild.channels.cache.get(args.channelId);
        if (item.data.publishedRevision !== item.revision || item.data.publishedChannelId !== args.channelId ||
            item.data.publishedMessageId !== args.messageId || !source ||
            !hasPermission(current.actor, P.ViewChannel, source)) throw new PlatformError('ticket_panel_not_authorized', 403);
        const questions = item.data.questions ?? [];
        if (questions.length) {
          for (const [key, value] of forms) if (value.expires < Date.now()) forms.delete(key);
          if (forms.size >= 1000) throw new PlatformError('ticket_forms_busy', 429);
          const key = randomUUID();
          forms.set(key, { args, questions, expires: Date.now() + 300000 });
          const form = new ModalBuilder().setCustomId(`smith:ticket:form:${key}`).setTitle(safeText(item.title, 45));
          for (const question of questions) form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId(question.id).setLabel(question.label).setStyle(TextInputStyle.Paragraph)
            .setRequired(question.required !== false).setMaxLength(question.maxLength ?? 1000)));
          await interaction.showModal(form);
          return true;
        }
      } else {
        const key = interaction.customId.slice('smith:ticket:form:'.length), form = forms.get(key);
        if (!form || form.expires < Date.now() || form.args.actorId !== interaction.user.id ||
            form.args.guildId !== interaction.guildId) throw new PlatformError('ticket_form_expired', 409);
        forms.delete(key);
        args = { ...form.args, answers: form.questions.map(q => ({ label: q.label, value: interaction.fields.getTextInputValue(q.id) })) };
      }
      await interaction.deferReply({ flags: 64 });
      const result = await open(args);
      await interaction.editReply(`Your private ticket is ready: <#${result.channelId}>.${result.intakeDelivered ? '' :
        ' Intake delivery was not confirmed; please enter your answers there. No duplicate ticket was created.'}`);
    } catch (error) {
      const content = error instanceof PlatformError ? `Ticket request refused: ${error.code}.` :
        'Ticket delivery is unconfirmed. Staff must inspect the saved request before retrying.';
      if (interaction.deferred || interaction.replied) await interaction.editReply(content);
      else await interaction.reply({ content, flags: 64 });
    }
    return true;
  }
  return { publish, open, staffAction, handleInteraction, stop: () => forms.clear() };
}
