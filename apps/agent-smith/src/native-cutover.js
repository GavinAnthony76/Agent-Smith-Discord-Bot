import { Routes } from 'discord.js';
import { connect } from './discord.js';
import { pool, locked, audit } from './db.js';
import { nativeSettings } from './native-settings.js';

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-native-published');
const instructions = 'Complete Discord’s rules screening and answer the required Faith / Gaming / Tech question in Channels & Roles. Your first recorded community stays fixed; changing your answer never grants another community. Use /interest for topics and /request for human-reviewed additional access. Say hello in #arrival-lounge.';
let client;
try {
  const connected = await connect({ allowWrites: apply });
  ({ client } = connected);
  const { guild } = connected;
  async function checks() {
    const state = await nativeSettings(connected);
    const errors = [...state.safetyErrors, ...state.publicationErrors];
    if (errors.length) {
      console.log('Cutover blockers:', JSON.stringify(errors));
      throw new Error('Pre-cutover checks failed.');
    }
    const messages = [];
    for (const name of ['welcome', 'rules', 'onboarding']) {
      const channelId = state.rows.find(r => r.kind === 'channel' && r.name === name)?.discord_id;
      const messageId = state.rows.find(r => r.kind === 'message' && r.name === name)?.discord_id;
      if (!channelId || !messageId) throw new Error('Tracked entry message is missing.');
      const channel = await guild.channels.fetch(channelId);
      const message = await channel.messages.fetch({ message: messageId, force: true });
      if (message.author.id !== client.user.id) throw new Error('Only tracked bot-owned messages may be updated.');
      messages.push({ name, message, signature: messageSignature(message) });
    }
    return { state, messages };
  }
  function messageSignature(message) {
    return JSON.stringify([message.content, message.components.map(c => c.toJSON()), message.editedTimestamp]);
  }
  const preflight = await checks();
  console.log('Checks passed: target, owner, rules screening, published required single-choice selection-only question, private gates, public arrival and tracked bot messages.');
  if (!apply) {
    console.log('PREVIEW ONLY. Nothing disabled or updated. After the owner confirms native UI is published, use --apply --confirm-native-published.');
  } else {
    if (!confirmed) throw new Error('Owner confirmation flag --confirm-native-published is required.');
    // This lock conflicts with every legacy grant's transaction lock. Already
    // running commands finish BEFORE the committed switch; later commands fail.
    await locked(`onboarding-mode:${guild.id}`, async db => {
      const rechecked = await checks();
      if (JSON.stringify(rechecked.state.onboarding) !== JSON.stringify(preflight.state.onboarding)
        || rechecked.messages.some((m, index) => m.signature !== preflight.messages[index].signature)) {
        throw new Error('Discord UI/messages changed during checks; retry instead of overwriting concurrent edits.');
      }
      const prior = (await db.query('SELECT * FROM onboarding_state WHERE guild_id=$1 FOR UPDATE', [guild.id])).rows[0];
      await db.query(`INSERT INTO onboarding_state(guild_id,legacy_enabled,cutover_status) VALUES($1,false,'cutting-over')
        ON CONFLICT(guild_id) DO UPDATE SET legacy_enabled=false,cutover_status='cutting-over',updated_at=now()`, [guild.id]);
      if (prior?.legacy_enabled !== false) await audit(db, client.user.id, 'native-cutover-started', { ownerConfirmedPublished: true });
    });
    // Database disable is committed BEFORE Discord command/message writes.
    // An interrupted cutover stays safely disabled; re-run the same command.
    const registered = await client.rest.get(Routes.applicationGuildCommands(client.user.id, guild.id));
    for (const command of registered.filter(c => ['accept', 'join'].includes(c.name))) {
      await client.rest.delete(Routes.applicationGuildCommand(client.user.id, guild.id, command.id));
    }
    for (const item of preflight.messages) {
      // Do not replace a concurrent human edit, even after the safety switch.
      await checks();
      const current = await item.message.channel.messages.fetch({ message: item.message.id, force: true });
      if (messageSignature(current) !== item.signature) throw new Error('Tracked entry message changed concurrently. Legacy remains disabled; inspect before resuming cutover.');
      let content;
      if (item.name === 'onboarding') {
        content = `**Native onboarding is active**\n${instructions}\nLegacy /accept, /join, buttons and menus are disabled. Frameworks and staff channels stay private.`;
      } else {
        content = current.content
          .replace('Start in #rules, then use /accept and /join in #onboarding.', '')
          .replace('Use /accept to accept these rules, then /join to choose ONE framework.', '');
        if (!content.includes(instructions)) content = `${content.trim()}\n\n${instructions}`;
      }
      if (content.length > 2000) throw new Error('Updated message would exceed Discord limit; preserve current text and inspect before resuming.');
      await current.edit({ content, components: [], allowedMentions: { parse: [] } });
    }
    await locked(`onboarding-mode:${guild.id}`, async db => {
      await checks();
      const remaining = await client.rest.get(Routes.applicationGuildCommands(client.user.id, guild.id));
      if (remaining.some(c => ['accept', 'join'].includes(c.name))) throw new Error('Legacy command registration raced with cutover; rerun safely.');
      await db.query("UPDATE onboarding_state SET cutover_status='native',updated_at=now() WHERE guild_id=$1 AND legacy_enabled=false", [guild.id]);
      await audit(db, client.user.id, 'native-cutover-completed', { preservedHumanReview: true, channelPermissionsUnchanged: true });
    });
    console.log('Native cutover complete. Old commands/components disabled; tracked entry messages updated. /request, human review, moderation, interests and trivia preserved.');
  }
} catch {
  console.error('Cutover refused or incomplete. No raw Discord requests/secrets printed. Old onboarding is unchanged if prechecks failed; after a started cutover it stays disabled for safe retry. Inspect onboarding_state and rerun the same checked command to recover.');
  process.exitCode = 1;
} finally { client?.destroy(); await pool.end(); }