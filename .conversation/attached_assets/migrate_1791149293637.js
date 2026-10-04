import { pool } from './db.js';
await pool.query(`
CREATE TABLE IF NOT EXISTS resources(guild_id text NOT NULL, kind text NOT NULL, name text NOT NULL, discord_id text NOT NULL, PRIMARY KEY(guild_id,kind,name));
CREATE TABLE IF NOT EXISTS members(guild_id text NOT NULL, user_id text NOT NULL, accepted_at timestamptz, primary_framework text, xp integer NOT NULL DEFAULT 0, last_trivia timestamptz, PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS requests(id bigserial PRIMARY KEY,guild_id text NOT NULL,user_id text NOT NULL,framework text NOT NULL,status text NOT NULL DEFAULT 'pending',reviewer text,created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS pending_request ON requests(guild_id,user_id,framework) WHERE status='pending';
CREATE TABLE IF NOT EXISTS grants(guild_id text NOT NULL,user_id text NOT NULL,framework text NOT NULL,reviewer text NOT NULL,created_at timestamptz DEFAULT now(),PRIMARY KEY(guild_id,user_id,framework));
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,guild_id text NOT NULL,actor text NOT NULL,action text NOT NULL,detail jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS feed_items(guild_id text NOT NULL,feed_id text NOT NULL,item_id text NOT NULL,sent_at timestamptz DEFAULT now(),PRIMARY KEY(guild_id,feed_id,item_id));
CREATE TABLE IF NOT EXISTS trivia_sessions(guild_id text NOT NULL,user_id text NOT NULL,answer text NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(guild_id,user_id));
`);
await pool.end(); console.log('Database ready');
