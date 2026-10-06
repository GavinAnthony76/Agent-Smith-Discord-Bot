import { readdir, readFile } from 'node:fs/promises';

export function inspectSecuritySource(name, source) {
  const failures=[];
  if(/\beval\s*\(|new\s+Function\s*\(/.test(source))failures.push(`Dynamic execution in ${name}`);
  if(/\bnew\s+Client\s*\(/.test(source)&&name!=='discord.js')failures.push(`Ungated Discord client in ${name}`);
  if(/\bnew\s+REST\s*\(/.test(source) && !(name==='native-diagnose.js' && !/rest\.(?:put|post|patch|delete)\(/.test(source))) {
    failures.push(`Ungated REST transport in ${name}`);
  }
  if(/fetch\s*\([^)]*(?:discord\.com|discordapp\.com)/s.test(source))failures.push(`Direct Discord HTTP transport in ${name}`);
  if(/(?:\.roles\.(?:add|remove)\(|\.members\.(?:ban|unban)\(|\.kick\(|\.timeout\(|\.bulkDelete\()/.test(source)
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
  for(const name of await readdir(new URL('.',import.meta.url))) {
    if(!name.endsWith('.js') || name==='security-source-audit.js')continue;
    failures.push(...inspectSecuritySource(name,await readFile(new URL(name,import.meta.url),'utf8')));
  }
  const gate=await readFile(new URL('./security-gate.js',import.meta.url),'utf8');
  const connection=await readFile(new URL('./discord.js',import.meta.url),'utf8');
  if(!gate.includes('withPrivilegedPipeline') || !connection.includes('installSecurityGate'))failures.push('Missing mandatory privileged pipeline installation.');
  return failures;
}
