import { connect } from './discord.js';
import { pool, resource, audit, locked } from './db.js';
import { onboardingMessage } from './onboarding.js';
import { legacyAllowed } from './native-policy.js';

// Update only the already-tracked bot message. Never bootstrap, create channels,
// replace identities, or open read-only channels to ordinary messages.
let client;
try {
  const connected = await connect({ allowWrites: true });
  client = connected.client;
  await locked(`onboarding-mode:${connected.guild.id}`, async db => {
  const state = (await db.query('SELECT * FROM onboarding_state WHERE guild_id=$1',[connected.guild.id])).rows[0];
  if (!legacyAllowed(state)) throw new Error('Native cutover has disabled the old controls; refresh refused.');
  const channel = await connected.guild.channels.fetch(await resource('channel', 'onboarding'));
  if (!channel?.isTextBased() || channel.name !== 'onboarding') {
    throw new Error('Tracked onboarding channel is missing or unexpected; no update made.');
  }
  const message = await channel.messages.fetch(await resource('message', 'onboarding'));
  if (message.author.id !== client.user.id) {
    throw new Error('Tracked onboarding message is not owned by this bot; no update made.');
  }
  await message.edit(onboardingMessage());
  await audit(db, client.user.id, 'onboarding-ui-updated', { channel: channel.id, message: message.id });
  console.log('Tracked onboarding message updated with rules button and community menu. Permissions unchanged.');
  });
} finally {
  client?.destroy();
  await pool.end();
}