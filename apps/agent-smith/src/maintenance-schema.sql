-- Additive: retain established SQL tables, timestamps, roles and approval history.
ALTER TABLE members ADD COLUMN IF NOT EXISTS joined_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS left_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'NEW';
ALTER TABLE members ADD COLUMN IF NOT EXISTS rules_version_accepted text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS rules_accepted_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS activation_date timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS interests_completed_at timestamptz;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_block_reason text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarding_flow text NOT NULL DEFAULT 'native';
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_authoritative boolean NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS info_requested_at timestamptz;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS info_request_reason text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='member_lifecycle_states' AND conrelid='members'::regclass) THEN
 ALTER TABLE members ADD CONSTRAINT member_lifecycle_states CHECK(onboarding_status IN
 ('NEW','RULES_PENDING','FRAMEWORK_PENDING','INTERESTS_PENDING','ACTIVE','ONBOARDING_BLOCKED'));
 END IF;
END $$;
-- Old acceptance is retained as unversioned, never invented or attributed to a new click.
UPDATE members SET rules_accepted_at=accepted_at,rules_version_accepted='legacy-unversioned'
 WHERE accepted_at IS NOT NULL AND rules_accepted_at IS NULL;
CREATE TABLE IF NOT EXISTS member_interests (
 guild_id text NOT NULL,user_id text NOT NULL,role_id text NOT NULL,framework text NOT NULL,
 name text NOT NULL,desired boolean NOT NULL,status text NOT NULL DEFAULT 'pending',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,user_id,role_id),CHECK(status IN ('pending','applied','blocked'))
);
CREATE INDEX IF NOT EXISTS interests_recovery ON member_interests(guild_id,status);
CREATE TABLE IF NOT EXISTS moderation_cases (
 case_id bigint PRIMARY KEY REFERENCES audit(id),guild_id text NOT NULL,user_id text,
 moderator_id text NOT NULL,action_type text NOT NULL,reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),duration_minutes integer,expires_at timestamptz,
 status text NOT NULL DEFAULT 'pending',active boolean NOT NULL DEFAULT false,
 resolved_at timestamptz,closed_at timestamptz,
 CHECK(status IN ('pending','completed','uncertain','failed','withdrawn'))
);
CREATE INDEX IF NOT EXISTS active_punishments ON moderation_cases(guild_id,user_id,expires_at) WHERE active;
CREATE TABLE IF NOT EXISTS moderation_case_notes (
 id bigserial PRIMARY KEY,guild_id text NOT NULL,case_id bigint NOT NULL REFERENCES moderation_cases(case_id),
 actor_id text NOT NULL,note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS member_reports (
 id bigserial PRIMARY KEY,guild_id text NOT NULL,reporter_id text NOT NULL,target_id text,
 reference text,reason text NOT NULL,status text NOT NULL DEFAULT 'open',claimed_by text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,CHECK(status IN ('open','claimed','escalated','dismissed','closed'))
);
CREATE INDEX IF NOT EXISTS reports_delivery ON member_reports(guild_id,id) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS report_actions (
 guild_id text NOT NULL,report_id bigint NOT NULL REFERENCES member_reports(id),
 operation text NOT NULL,actor_id text NOT NULL,status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,report_id,operation)
);
CREATE TABLE IF NOT EXISTS worker_health (
 guild_id text NOT NULL,worker text NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),
 detail jsonb NOT NULL DEFAULT '{}',PRIMARY KEY(guild_id,worker)
);
CREATE TABLE IF NOT EXISTS community_wallets (
 guild_id text NOT NULL,user_id text NOT NULL,balance integer NOT NULL DEFAULT 0 CHECK(balance>=0),
 PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS community_shop (
 guild_id text NOT NULL,item_id text NOT NULL,title text NOT NULL,price integer NOT NULL CHECK(price>0),
 enabled boolean NOT NULL DEFAULT true,PRIMARY KEY(guild_id,item_id)
);
CREATE TABLE IF NOT EXISTS community_inventory (
 guild_id text NOT NULL,user_id text NOT NULL,item_id text NOT NULL,title text NOT NULL,
 bought_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,user_id,item_id)
);
CREATE TABLE IF NOT EXISTS community_transactions (
 guild_id text NOT NULL,user_id text NOT NULL,event_key text NOT NULL,amount integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,user_id,event_key)
);
CREATE TABLE IF NOT EXISTS automod_observations (
 guild_id text NOT NULL,user_id text NOT NULL,message_id text NOT NULL,content_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,message_id)
);
CREATE INDEX IF NOT EXISTS automod_window ON automod_observations(guild_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS automod_actions (
 guild_id text NOT NULL,message_id text NOT NULL,rule text NOT NULL,action text NOT NULL,
 status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,message_id,rule)
);
CREATE TABLE IF NOT EXISTS text_participation (
 guild_id text NOT NULL,user_id text NOT NULL,message_id text NOT NULL,content_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guild_id,message_id)
);
CREATE INDEX IF NOT EXISTS text_duplicate_window ON text_participation(guild_id,user_id,content_hash,created_at);
-- Preserve known old results; absence/lost acknowledgment is NOT proof of failure.
INSERT INTO moderation_cases(case_id,guild_id,user_id,moderator_id,action_type,reason,created_at,
 duration_minutes,expires_at,status,active)
SELECT a.id,a.guild_id,a.detail->>'target',a.actor,
 CASE WHEN a.action='mod.warn' THEN 'warn' ELSE a.detail->>'operation' END,
 COALESCE(a.detail->>'reason',''),a.created_at,
 CASE WHEN a.detail->>'minutes' ~ '^[0-9]{1,5}$' THEN (a.detail->>'minutes')::integer END,
 CASE WHEN a.detail->>'minutes' ~ '^[0-9]{1,5}$' THEN a.created_at+((a.detail->>'minutes')::integer*interval '1 minute') END,
 CASE WHEN a.action='mod.warn' THEN
  CASE WHEN EXISTS(SELECT 1 FROM audit w WHERE w.guild_id=a.guild_id AND w.action='mod.unwarn' AND w.detail->>'warningCase'=a.id::text) THEN 'withdrawn' ELSE 'completed' END
  WHEN r.detail->>'status'='completed' THEN 'completed'
  WHEN r.detail->>'errorCode' IN ('50013','50001','50035','10007') THEN 'failed' ELSE 'uncertain' END,
 COALESCE((a.action='mod.warn' AND NOT EXISTS(SELECT 1 FROM audit w WHERE w.guild_id=a.guild_id AND w.action='mod.unwarn' AND w.detail->>'warningCase'=a.id::text))
 OR (r.detail->>'status'='completed' AND a.detail->>'operation' IN ('timeout','ban')
 AND NOT EXISTS(SELECT 1 FROM audit u JOIN audit ur ON ur.guild_id=u.guild_id AND ur.action='mod.result'
  AND ur.detail->>'caseId'=u.id::text AND ur.detail->>'status'='completed'
  WHERE u.guild_id=a.guild_id AND u.action='mod.intent' AND u.detail->>'target'=a.detail->>'target'
  AND u.created_at>a.created_at AND u.detail->>'operation'=CASE WHEN a.detail->>'operation'='ban' THEN 'unban' ELSE 'untimeout' END)),false)
FROM audit a LEFT JOIN LATERAL
 (SELECT detail FROM audit WHERE guild_id=a.guild_id AND action='mod.result' AND detail->>'caseId'=a.id::text ORDER BY id DESC LIMIT 1) r ON true
WHERE a.action IN ('mod.warn','mod.intent')
ON CONFLICT(case_id) DO NOTHING;
