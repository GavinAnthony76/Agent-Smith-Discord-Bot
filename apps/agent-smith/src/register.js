import { Routes } from 'discord.js';
import { connect } from './discord.js';
import { commands } from './commands.js';
import { legacyAllowed } from './native-policy.js';
const body = commands.map(command => command.toJSON());
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'plan-only', commands: body }, null, 2));
  console.log('No Discord connection made. Re-run with --apply only after confirming the fixed Hallowed Core target.');
} else {
  const { pool, locked } = await import('./db.js');
  const { client, cfg, guild } = await connect({ allowWrites: true });
  try {
    await locked(`onboarding-mode:${guild.id}`,async db=>{
      const state = (await db.query('SELECT * FROM onboarding_state WHERE guild_id=$1',[guild.id])).rows[0];
      await client.rest.put(Routes.applicationGuildCommands(cfg.clientId, guild.id), { body: legacyAllowed(state) ? body : body.filter(c=>!['accept','join'].includes(c.name)) });
    });
    console.log('Guild slash commands registered for the confirmed target.');
  } finally {
    client.destroy();
    await pool.end();
  }
}
