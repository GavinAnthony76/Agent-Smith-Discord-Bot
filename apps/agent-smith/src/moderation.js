import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { categories } from './blueprint.js';
import { assertModerator, assertTarget, validReason, discordId, moderationPermissions, purgeCandidates, Confirmations } from './moderation-policy.js';
import { parseRequestId } from './review.js';

const PREFIX = 'smith:mod:';
const confirmedOperations = new Set(['kick', 'ban', 'unban', 'purge']);
const protectedNames = new Set(categories.flatMap(category =>
  category.channels.filter(([, , readonly]) => readonly || category.gate === 'staff' || !category.gate).map(([name]) => name)));

export function isModerationInteraction(interaction) {
  return (interaction.isChatInputCommand() && interaction.commandName === 'mod')
    || (interaction.isButton() && interaction.customId.startsWith(PREFIX));
}

export function createModeration({ guild, cfg, pool, resource, spam, confirmations = new Confirmations() }) {
  async function record(actor, action, detail) {
    const result = await pool.query(
      'INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4) RETURNING id',
      [guild.id, actor, action, JSON.stringify(detail)]);
    return String(result.rows[0].id);
  }
  async function mirror(caseId, actor, description) {
    try {
      const channel = await guild.channels.fetch(await resource('channel', 'audit-log'));
      if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new Error('Audit channel is public');
      await channel.send({ content: `**Moderation case #${caseId}** | owner <@${actor}>\n${description}`.slice(0, 1900),
        allowedMentions: { parse: [] } });
    } catch {
      console.error('Moderation audit mirror unavailable; durable database record is authoritative.');
    }
  }
  async function actors(actorId, operation, channel) {
    const actor = await guild.members.fetch({ user: actorId, force: true });
    const bot = await guild.members.fetchMe();
    const permission = moderationPermissions[operation];
    if (permission) {
      const actorPermissions = channel ? channel.permissionsFor(actor) : actor.permissions;
      if (!actorPermissions?.has(permission)) throw new Error(`Your Discord account needs ${operation === 'purge' ? 'Manage Messages in that channel' : permissionName(operation)} permission.`);
      const botPermissions = channel ? channel.permissionsFor(bot) : bot.permissions;
      if (!botPermissions?.has(permission)) throw new Error(`Agent Smith needs ${operation === 'purge' ? 'Manage Messages in that channel' : permissionName(operation)}. Ask the server owner to grant that specific permission, not Administrator.`);
    }
    return { actor, bot };
  }
  async function purgeChannel(id) {
    const channel = await guild.channels.fetch(id);
    if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildText) throw new Error('Choose a text channel in this server.');
    const rows = await pool.query('SELECT kind,name,discord_id FROM resources WHERE guild_id=$1', [guild.id]);
    if (rows.rows.some(row => row.discord_id === id && (row.kind === 'starter-channel' || row.kind === 'community-channel'
      || (row.kind === 'channel' && protectedNames.has(row.name))))) {
      throw new Error('Cleanup is blocked in rules, onboarding, read-only, staff/audit, Community updates, and preserved starter channels.');
    }
    return channel;
  }
  async function validate(action, actorId) {
    assertModerator(actorId, cfg);
    if (action.operation === 'unban') {
      discordId(action.target);
      if (action.target === guild.ownerId || cfg.owners.includes(action.target) || action.target === cfg.clientId) {
        throw new Error('Protected owner/bot accounts cannot be targeted.');
      }
      await actors(actorId, 'unban');
      await guild.bans.fetch(action.target);
      return {};
    }
    if (action.operation === 'purge') {
      const channel = await purgeChannel(action.channel);
      await actors(actorId, 'purge', channel);
      return { channel };
    }
    const { actor, bot } = await actors(actorId, action.operation);
    const target = await guild.members.fetch({ user: action.target, force: true });
    assertTarget({ actor, bot, target, guildOwnerId: guild.ownerId, owners: cfg.owners, operation: action.operation });
    return { target };
  }
  async function execute(action, actorId) {
    const context = await validate(action, actorId); // Recheck hierarchy and permissions at confirmation time.
    if (action.operation === 'warn') {
      const caseId = await record(actorId, 'mod.warn', action);
      let notified = true;
      try { await context.target.send({ content: `You received a warning in ${guild.name} (case #${caseId}).\nReason: ${action.reason}`, allowedMentions: { parse: [] } }); }
      catch { notified = false; }
      await mirror(caseId, actorId, `Warning for <@${action.target}>: ${action.reason}`);
      return `Warning recorded as case #${caseId}.${notified ? ' Private notification sent.' : ' The member’s private notification could not be delivered; the warning is still recorded.'}`;
    }
    // Persist intent BEFORE calling Discord. A missing result is an operator-visible recovery case.
    const caseId = await record(actorId, 'mod.intent', action);
    let count;
    try {
      const reason = `Case #${caseId}; owner ${actorId}; ${action.reason}`.slice(0, 500);
      if (action.operation === 'timeout') await context.target.timeout(action.minutes * 60000, reason);
      else if (action.operation === 'untimeout') await context.target.timeout(null, reason);
      else if (action.operation === 'kick') await context.target.kick(reason);
      else if (action.operation === 'ban') await guild.members.ban(action.target, { reason, deleteMessageSeconds: 0 });
      else if (action.operation === 'unban') await guild.members.unban(action.target, reason);
      else if (action.operation === 'purge') {
        const latest = await context.channel.messages.fetch({ limit: 100 });
        const ids = new Set(action.messageIds);
        const eligible = purgeCandidates(latest).filter(message => ids.has(message.id)).map(message => message.id);
        count = eligible.length ? (await context.channel.bulkDelete(eligible, true)).size : 0;
      } else throw new Error('Unknown moderation operation.');
    } catch (error) {
      await record(actorId, 'mod.result', { caseId, target: action.target, operation: action.operation, status: 'failed', errorCode: error.code ?? null });
      throw new Error(`Case #${caseId} failed: ${error.message}`);
    }
    try {
      await record(actorId, 'mod.result', { caseId, target: action.target, operation: action.operation, status: 'completed', count });
    } catch {
      throw new Error(`Discord action succeeded for case #${caseId}, but recording the result failed. Do NOT retry blindly; inspect Discord and the pending audit intent.`);
    }
    await mirror(caseId, actorId, `${action.operation}${action.target ? ` for <@${action.target}>` : ` in <#${action.channel}>`}: ${action.reason}${count !== undefined ? ` (${count} messages deleted)` : ''}`);
    return `Case #${caseId}: ${action.operation} completed.${count !== undefined ? ` Deleted ${count} of the approved messages; pinned, old, missing, or newer messages were skipped.` : ''}`;
  }
  function context(interaction) {
    return { actorId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId };
  }
  return {
    async handle(interaction) {
      try {
        if (interaction.guildId !== guild.id || interaction.user.bot) throw new Error('This command is restricted to the authorized server and human owners.');
        assertModerator(interaction.user.id, cfg);
        const controlIds = await Promise.all(['smith-controls', 'access-review'].map(name => resource('channel', name)));
        if (!controlIds.includes(interaction.channelId)) throw new Error('Use moderation commands in #smith-controls or #access-review.');
        if (interaction.isButton()) {
          await interaction.deferUpdate();
          if (interaction.message.author.id !== cfg.clientId) throw new Error('Use the bot’s confirmation message.');
          const match = /^smith:mod:(confirm|cancel):([a-f0-9-]{36})$/.exec(interaction.customId);
          if (!match) throw new Error('Invalid confirmation button.');
          const action = confirmations.consume(match[2], context(interaction));
          if (match[1] === 'cancel') {
            await interaction.editReply({ content: 'Cancelled. No moderation action was taken.', components: [] }); return;
          }
          const result = await execute(action, interaction.user.id);
          await interaction.editReply({ content: result, components: [], allowedMentions: { parse: [] } }); return;
        }
        await interaction.deferReply({ flags: 64 });
        const operation = interaction.options.getSubcommand();
        if (operation === 'status') {
          const bot = await guild.members.fetchMe();
          const missing = [...new Set(Object.keys(moderationPermissions).filter(key => !bot.permissions.has(moderationPermissions[key])).map(permissionName))];
          const state = spam.status();
          const unresolved = await pool.query(
            "SELECT a.id FROM audit a WHERE a.guild_id=$1 AND a.action='mod.intent' AND NOT EXISTS (SELECT 1 FROM audit r WHERE r.guild_id=a.guild_id AND r.action='mod.result' AND r.detail->>'caseId'=a.id::text) ORDER BY a.id DESC LIMIT 10", [guild.id]);
          await interaction.editReply({ content: `**Owner-only moderation**\nAnti-spam: ${state.enabled ? 'enabled' : 'disabled'}, alerts only. No automatic punishment.\nTriggers: ${state.burstThreshold}; ${state.sustainedThreshold}; ${state.mentionThreshold}. Alerts have a ${state.cooldown} cooldown.\nMessage content is not scanned or stored.\nBot permissions missing at server level: ${missing.join(', ') || 'none'}. Channel overrides and hierarchy are checked per action.\nUnresolved action intents: ${unresolved.rows.map(row => `#${row.id}`).join(', ') || 'none'}. Investigate these before retrying an action.`,
            allowedMentions: { parse: [] } }); return;
        }
        if (operation === 'antispam') {
          const enabled = interaction.options.getBoolean('enabled', true);
          const reason = validReason(interaction.options.getString('reason', true));
          const caseId = await record(interaction.user.id, 'mod.spam-config', { enabled, mode: 'alerts-only', reason });
          spam.setEnabled(enabled);
          await mirror(caseId, interaction.user.id, `Anti-spam alerts ${enabled ? 'enabled' : 'disabled'}: ${reason}`);
          await interaction.editReply(`Anti-spam alerts ${enabled ? 'enabled' : 'disabled'} (case #${caseId}). Automatic punishment remains OFF.`); return;
        }
        if (operation === 'history') {
          const user = interaction.options.getUser('user', true);
          const rows = await pool.query(
            "SELECT a.id,a.action,a.detail,a.created_at,EXISTS(SELECT 1 FROM audit w WHERE w.guild_id=a.guild_id AND w.action='mod.unwarn' AND w.detail->>'warningCase'=a.id::text) AS withdrawn FROM audit a WHERE a.guild_id=$1 AND a.action LIKE 'mod.%' AND a.detail->>'target'=$2 ORDER BY a.id DESC LIMIT 15", [guild.id, user.id]);
          const lines = rows.rows.map(row => `#${row.id} ${row.action}${row.withdrawn ? ' [withdrawn]' : ''}: ${row.detail.reason?.slice(0, 70) || row.detail.status || row.detail.reasons?.join('; ') || 'See audit record'}`);
          await interaction.editReply({ content: (`**Recent moderation history**\n${lines.join('\n') || 'No cases for this member.'}`).slice(0, 1900),
            allowedMentions: { parse: [] } }); return;
        }
        if (operation === 'unwarn') {
          const warningCase = parseRequestId(interaction.options.getString('case', true));
          const reason = validReason(interaction.options.getString('reason', true));
          // Serialize withdrawal without deleting the original warning.
          const db = await pool.connect();
          let caseId;
          try {
            await db.query('BEGIN');
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`warning:${guild.id}:${warningCase}`]);
            const warning = (await db.query("SELECT detail FROM audit WHERE guild_id=$1 AND id=$2 AND action='mod.warn'", [guild.id, warningCase])).rows[0];
            if (!warning) throw new Error('Warning case not found. Use /mod history to find its case number.');
            const prior = await db.query("SELECT id FROM audit WHERE guild_id=$1 AND action='mod.unwarn' AND detail->>'warningCase'=$2", [guild.id, warningCase]);
            if (prior.rows.length) throw new Error('This warning was already withdrawn.');
            const saved = await db.query('INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4) RETURNING id',
              [guild.id, interaction.user.id, 'mod.unwarn', JSON.stringify({ warningCase, target: warning.detail.target, reason })]);
            caseId = String(saved.rows[0].id); await db.query('COMMIT');
          } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
          await mirror(caseId, interaction.user.id, `Warning #${warningCase} withdrawn: ${reason}`);
          await interaction.editReply(`Warning #${warningCase} withdrawn (case #${caseId}). Original history preserved.`); return;
        }
        const action = { operation, reason: validReason(interaction.options.getString('reason', true)) };
        if (operation === 'purge') {
          action.channel = interaction.options.getChannel('channel', true).id;
          const amount = interaction.options.getInteger('amount', true);
          if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('Choose 1–100 messages.');
          const { channel } = await validate(action, interaction.user.id);
          action.messageIds = purgeCandidates(await channel.messages.fetch({ limit: amount })).map(message => message.id);
          if (!action.messageIds.length) throw new Error('No eligible unpinned messages younger than 14 days were found.');
        } else {
          action.target = operation === 'unban' ? discordId(interaction.options.getString('user_id', true))
            : interaction.options.getUser('user', true).id;
          if (operation === 'timeout') {
            action.minutes = interaction.options.getInteger('minutes', true);
            if (!Number.isInteger(action.minutes) || action.minutes < 1 || action.minutes > 40320) throw new Error('Timeouts must be 1–40320 minutes.');
          }
          await validate(action, interaction.user.id);
        }
        if (confirmedOperations.has(operation)) {
          const token = confirmations.create(action, context(interaction));
          await interaction.editReply({
            content: `**Confirm ${operation}** ${action.target ? `for <@${action.target}>` : `of up to ${action.messageIds.length} approved messages in <#${action.channel}>`}?\nReason: ${action.reason}\n${operation === 'purge' ? 'Deleted messages cannot be restored.' : operation === 'unban' ? 'This lets the user rejoin by invitation; it does not restore access roles.' : 'This removes the member from the server. Existing access records and message history will be preserved.'}\nOnly you can confirm. Expires in two minutes.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${PREFIX}confirm:${token}`).setLabel('Confirm action').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`${PREFIX}cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))],
            allowedMentions: { parse: [] }
          }); return;
        }
        await interaction.editReply({ content: await execute(action, interaction.user.id), allowedMentions: { parse: [] } });
      } catch (error) {
        console.error('Moderation action refused or failed:', error.message);
        const reply = { content: `Unable to complete: ${error.message}`.slice(0, 1900), components: [], allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply({ ...reply, flags: 64 }).catch(() => {});
      }
    }
  };
}

function permissionName(operation) {
  return ({ timeout: 'Moderate Members', untimeout: 'Moderate Members', kick: 'Kick Members',
    ban: 'Ban Members', unban: 'Ban Members', purge: 'Manage Messages' })[operation];
}