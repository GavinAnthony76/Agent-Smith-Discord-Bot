import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';
const c=config();
await new REST().setToken(c.token).put(Routes.applicationGuildCommands(c.clientId,c.guildId),{body:commands.map(x=>x.toJSON())});
console.log('Guild slash commands registered');
