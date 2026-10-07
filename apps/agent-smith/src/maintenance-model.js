import { pgTable, text, timestamp, boolean, primaryKey } from 'drizzle-orm/pg-core';
export const memberInterests=pgTable('member_interests',{
 guildId:text('guild_id').notNull(),userId:text('user_id').notNull(),roleId:text('role_id').notNull(),
 framework:text('framework').notNull(),name:text('name').notNull(),desired:boolean('desired').notNull(),
 status:text('status').notNull().default('pending'),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
},t=>[primaryKey({columns:[t.guildId,t.userId,t.roleId]})]);
