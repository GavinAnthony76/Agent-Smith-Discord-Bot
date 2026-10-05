import { connect } from './discord.js';
import { pool, resource, audit, locked } from './db.js';
import { accessRequestMessage } from './access-request.js';

// Edit only the existing tracked bot message. No bootstrap, permission edits,
// role grants, channel creation, or legacy onboarding reactivation.
const apply = process.argv.includes('--apply');
let client;
try {
  const connected = await connect({ allowWrites: apply });
  client = connected.client;
  await locked(`bootstrap:${connected.guild.id}`, async db => {
    const channel = await connected.guild.channels.fetch(await resource('channel', 'access-requests', db));
    if (!channel?.isTextBased() || channel.name !== 'access-requests') {
      throw new Error('Tracked access-requests channel is missing or unexpected; no update made.');
    }
    const message = await channel.messages.fetch(await resource('message', 'access-requests', db));
    if (message.author.id !== client.user.id) {
      throw new Error('Tracked access-request message is not owned by this bot; no update made.');
    }
    if (!apply) {
      console.log('Preview: update only the tracked access-requests message with a private request menu. No Discord changes made.');
      return;
    }
    await message.edit(accessRequestMessage());
    await audit(db, client.user.id, 'access-request-ui-updated', { channel: channel.id, message: message.id });
    console.log('Tracked access-request message updated. Permissions and resource IDs unchanged; requests still require human approval.');
  });
} finally {
  client?.destroy();
  await pool.end();
}
