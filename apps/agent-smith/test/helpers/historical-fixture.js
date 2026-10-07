import { PermissionsBitField,PermissionFlagsBits as P } from 'discord.js';
import { registerSecurityConfiguration } from '../../src/security-policy.js';
import { createHistoricalReview } from '../../src/historical-review.js';
import { frameworks } from '../../src/blueprint.js';

export const ids={guild:'123456789012345678',member:'223456789012345678',owner:'323456789012345678',
 secondary:'423456789012345678',admin:'523456789012345678',approver:'623456789012345678',bot:'723456789012345678'};
export function historicalFixture(pool,locked) {
 const cfg={ownerDiscordId:ids.owner,owners:[ids.owner,ids.secondary],approvers:[ids.approver]};
 const roles=Object.fromEntries(['Member',...frameworks].map(n=>[n,`role-${n}`]));
 const cache=new Map(Object.entries(roles).map(([name,id])=>[id,{id,name,editable:true,permissions:new PermissionsBitField(0n)}]));
 const mutations=[];
 const all=new Map();
 const guild={id:ids.guild,ownerId:ids.owner,async fetch(){return guild;},roles:{cache,async fetch(id){return cache.get(id);}},
  members:{async fetch({user}){if(!all.has(user))throw new Error('Member left');return all.get(user);}}};
 for(const id of Object.values(ids).filter(id=>id!==ids.guild))all.set(id,{id,guild,user:{id,bot:id===ids.bot},pending:false,
  permissions:new PermissionsBitField(id===ids.admin?P.Administrator:0n),
  roles:{cache:new Map(),async add(){mutations.push('add');throw new Error('Historical review must not add roles');},
   async remove(){mutations.push('remove');throw new Error('Historical review must not remove roles');}}});
 const member=all.get(ids.member);
 for(const f of frameworks)member.roles.cache.set(roles[f],cache.get(roles[f]));
 registerSecurityConfiguration(guild,cfg);
 const resource=async(_kind,name)=>roles[name];
 const audit=(db,actor,action,detail,currentTime=false)=>db.query(currentTime
  ?'INSERT INTO audit(guild_id,actor,action,detail,created_at) VALUES($1,$2,$3,$4,clock_timestamp())'
  :'INSERT INTO audit(guild_id,actor,action,detail) VALUES($1,$2,$3,$4)',
  [ids.guild,actor,action,JSON.stringify(detail)]);
 const context=async(uid,db=pool)=>({member:await guild.members.fetch({user:uid}),
  record:(await db.query('SELECT * FROM members WHERE guild_id=$1 AND user_id=$2',[ids.guild,uid])).rows[0],
  grants:(await db.query('SELECT framework FROM grants WHERE guild_id=$1 AND user_id=$2',[ids.guild,uid])).rows.map(r=>r.framework),
  ids:roles});
 const ctx={guild,cfg,pool,locked,audit,context,resource,client:{user:{id:ids.bot}}};
 return {...ctx,all,member,roles,mutations,review:createHistoricalReview(ctx)};
}

// Transaction-local state and rollback for offline adversarial tests.
export function memoryHistory() {
 let state={record:null,grants:[],audit:[],requests:[],version:'1'};
 function connection(get) {
  return {async query(sql,p=[]) {
   const s=get();let rows=[];
   if(sql.startsWith('SELECT value FROM bot_settings'))rows=[{value:s.version}];
   else if(sql.startsWith('SELECT * FROM members'))rows=s.record?[structuredClone(s.record)]:[];
   else if(sql.startsWith('SELECT framework FROM grants'))rows=s.grants.map(g=>({framework:g.framework}));
   else if(sql.includes("action='historical-framework-consent'"))
    rows=s.audit.filter(a=>a.actor===p[1]&&a.action==='historical-framework-consent'&&a.detail.subject===p[1]).slice(-1).reverse();
   else if(sql.startsWith('SELECT id FROM requests'))rows=s.requests.filter(r=>r.framework===p[2]&&r.status==='pending');
   else if(sql.startsWith('SELECT user_id FROM members'))rows=s.record?[{user_id:p[1]}]:[];
   else if(sql.startsWith('INSERT INTO audit')) {
    if(s.failAudit&&p[2]==='historical-framework-reviewed')throw new Error('Audit storage failed');
    s.audit.push({id:s.audit.length+1,created_at:new Date(),actor:p[1],action:p[2],detail:JSON.parse(p[3])});
   } else if(sql.startsWith('INSERT INTO members'))s.record??={guild_id:p[0],user_id:p[1],accepted_at:null,primary_framework:null,access_authoritative:false};
   else if(sql.startsWith('UPDATE members SET primary_framework')) {
    if(!s.record.accepted_at){s.record.rules_version_accepted=p[4];s.record.rules_accepted_at=p[3];}
    s.record.primary_framework??=p[2];s.record.accepted_at??=p[3];
    if(p[5])s.record.access_authoritative=false;
   } else if(sql.startsWith('INSERT INTO grants')) {
    if(!s.grants.some(g=>g.framework===p[2]))s.grants.push({framework:p[2],reviewer:p[3],created_at:new Date()});
   } else throw new Error(`Unexpected fake query: ${sql}`);
   return {rows,rowCount:rows.length};
  }};
 }
 const pool=connection(()=>state);
 const locked=async(_key,fn)=>{
  const local=structuredClone(state);
  const result=await fn(connection(()=>local));
  state=local;return result;
 };
 return {pool,locked,get state(){return state;},fixture:historicalFixture(pool,locked)};
}
