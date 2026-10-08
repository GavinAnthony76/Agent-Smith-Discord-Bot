import { readdir, readFile } from 'node:fs/promises';

export function inspectSecuritySource(name, source) {
  const failures=[];
  if(/\beval\s*\(|new\s+Function\s*\(/.test(source))failures.push(`Dynamic execution in ${name}`);
  const readOnlyIdentityClient=name==='platform/discord-access.js' &&
    /new Client\(\{\s*intents:\s*\[\]\s*\}\)/.test(source) &&
    /installSecurityGateForRestOnly\(client\)/.test(source) &&
    !/\.login\s*\(|rest\.(?:post|put|patch|delete)\s*\(/.test(source);
  if(/\bnew\s+Client\s*\(/.test(source)&&name!=='discord.js'&&!readOnlyIdentityClient)failures.push(`Ungated Discord client in ${name}`);
  if(/\bnew\s+REST\s*\(/.test(source) && !(name==='native-diagnose.js' && !/rest\.(?:put|post|patch|delete)\(/.test(source))) {
    failures.push(`Ungated REST transport in ${name}`);
  }
  if(/fetch\s*\([^)]*(?:discord\.com|discordapp\.com)/s.test(source))failures.push(`Direct Discord HTTP transport in ${name}`);
  // Node's AbortSignal deadline is not a Discord member timeout.
  const mutationSource=source.replace(/\bAbortSignal\.timeout\s*\(/g,'nodeDeadline(');
  if(/(?:\.roles\.(?:add|remove)\(|\.members\.(?:ban|unban)\(|\.kick\(|\.timeout\(|\.bulkDelete\()/.test(mutationSource)
    && !/with(?:Role|Moderation)Workflow/.test(source))failures.push(`Privileged mutation missing trusted scope in ${name}`);
  if(/(?:^|[-_.])(?:ai|llm)(?:[-_.]|$)|smith-ask/i.test(name)
    && /(?:from\s*|import\s*\()\s*['"][^'"]*(?:discord|security-policy|security-gate|privileged-pipeline|db\.js|config\.js)/.test(source)) {
    failures.push(`AI imports privileged capability in ${name}`);
  }
  if(['bot.js','moderation.js','progression-interactions.js','smith-control.js'].includes(name)
    && /\.permissions\.has\(|\.permissionsFor\(/.test(source))failures.push(`Handler bypasses central permission resolver in ${name}`);
  return failures;
}
export async function auditSecuritySource() {
  const failures=[];
  async function inspectDirectory(directory, prefix='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(entry.isDirectory()) { await inspectDirectory(new URL(`${entry.name}/`,directory),`${prefix}${entry.name}/`);continue; }
      if(!entry.name.endsWith('.js') || entry.name==='security-source-audit.js')continue;
      failures.push(...inspectSecuritySource(`${prefix}${entry.name}`,await readFile(new URL(entry.name,directory),'utf8')));
    }
  }
  await inspectDirectory(new URL('.',import.meta.url));
  const gate=await readFile(new URL('./security-gate.js',import.meta.url),'utf8');
  const connection=await readFile(new URL('./discord.js',import.meta.url),'utf8');
  if(!gate.includes('withPrivilegedPipeline') || !connection.includes('installSecurityGate'))failures.push('Missing mandatory privileged pipeline installation.');
  return failures;
}
