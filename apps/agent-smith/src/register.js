import { REST, Routes } from 'discord.js';
import { connect } from './discord.js';
import { commands } from './commands.js';
const body = commands.map(command => command.toJSON());
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'plan-only', commands: body }, null, 2));
  console.log('No Discord connection made. Re-run with --apply only after confirming the fixed Hallowed Core target.');
} else {
  const { client, cfg, guild } = await connect({ allowWrites: true });
  try {
    await new REST().setToken(cfg.token).put(Routes.applicationGuildCommands(cfg.clientId, guild.id), { body });
    console.log('Guild slash commands registered for the confirmed target.');
  } finally {
    client.destroy();
  }
}
