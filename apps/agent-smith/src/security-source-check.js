import { auditSecuritySource } from './security-source-audit.js';
const failures=await auditSecuritySource();
if(failures.length){for(const failure of failures)console.error(`UNSAFE: ${failure}`);process.exitCode=1;}
else console.log('Static privileged-transport, permission-resolver and AI-boundary checks passed.');
