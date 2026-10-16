const observations=new Map();
const states=new Set(['HEALTHY','DEGRADED','ERROR','DISABLED','UNKNOWN']);
export function observeSubsystem(guildId,key,status,detail) {
  if(!states.has(status)) throw new Error('Invalid subsystem observation.');
  observations.set(`${guildId}:${key}`,{status,detail,at:new Date().toISOString()});
}
export function subsystemObservation(guildId,key) {
  const value=observations.get(`${guildId}:${key}`);
  if(!value) return {status:'UNKNOWN',detail:'No runtime observation available.',at:null};
  if(Date.now()-Date.parse(value.at)>120000)
    return {...value,status:'UNKNOWN',detail:'Last runtime observation is stale.'};
  return value;
}
