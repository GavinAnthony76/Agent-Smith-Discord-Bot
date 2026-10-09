-- Additive platform foundation. Apply to development explicitly.
-- Never run this file from bot startup or a production build.
CREATE TABLE IF NOT EXISTS platform_runtime_state (
 guild_id text PRIMARY KEY CHECK(guild_id ~ '^[0-9]{17,20}$'),
 activated_at timestamptz NOT NULL,
 last_seen_at timestamptz NOT NULL,
 bot_connected boolean NOT NULL DEFAULT false,
 runtime_active boolean NOT NULL DEFAULT false,
 module_states jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS platform_guilds (
 guild_id text PRIMARY KEY CHECK(guild_id ~ '^[0-9]{17,20}$'),
 installed boolean NOT NULL DEFAULT true,
 policy_key text NOT NULL DEFAULT 'standard',
 settings jsonb NOT NULL DEFAULT '{}',
 setup_complete boolean NOT NULL DEFAULT false,
 installed_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_managers (
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 user_id text NOT NULL,
 dashboard_role text NOT NULL CHECK(dashboard_role IN ('ADMIN','MODERATOR','COMMUNITY_MANAGER','VIEW_ONLY')),
 added_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS platform_modules (
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 module_key text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 configuration_json jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,module_key)
);
CREATE TABLE IF NOT EXISTS platform_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 actor_user_id text NOT NULL,action text NOT NULL,module text NOT NULL,
 before_state jsonb NOT NULL DEFAULT '{}',after_state jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_guild_time ON platform_audit(guild_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS platform_entitlements (
 guild_id text PRIMARY KEY REFERENCES platform_guilds(guild_id),
 plan text NOT NULL DEFAULT 'FREE' CHECK(plan IN ('FREE','PRO','ULTIMATE')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 limit_overrides jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_billing_customers (
 guild_id text PRIMARY KEY REFERENCES platform_guilds(guild_id),
 stripe_customer_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_subscriptions (
 guild_id text PRIMARY KEY REFERENCES platform_guilds(guild_id),
 stripe_subscription_id text UNIQUE,
 plan text NOT NULL DEFAULT 'FREE',
 status text NOT NULL DEFAULT 'disabled',
 current_period_end timestamptz
);
CREATE TABLE IF NOT EXISTS platform_subscription_events (
 event_id text PRIMARY KEY,
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 event_type text NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);
-- No automatic guild registration/backfill here: identify the real installed
-- guild and preserve its existing settings through the runtime adoption service.
CREATE TABLE IF NOT EXISTS platform_sessions (
 session_hash text PRIMARY KEY,user_id text NOT NULL,identity jsonb NOT NULL,
 token_ciphertext text NOT NULL,csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_sessions_expiry ON platform_sessions(expires_at);
CREATE TABLE IF NOT EXISTS platform_oauth_states (
 state_hash text PRIMARY KEY,browser_hash text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_records (
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 collection text NOT NULL,record_id text NOT NULL,
 title text NOT NULL,data jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,collection,record_id)
);
CREATE TABLE IF NOT EXISTS platform_activity (
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),
 event_key text NOT NULL,kind text NOT NULL,channel_id text,
 user_hash text,amount bigint NOT NULL DEFAULT 1,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,event_key)
);
CREATE INDEX IF NOT EXISTS platform_activity_guild_time ON platform_activity(guild_id,occurred_at,kind);
CREATE TABLE IF NOT EXISTS platform_ticket_channels (
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),ticket_id text NOT NULL,
 creator_id text NOT NULL,panel_id text NOT NULL,channel_id text,
 claimed_by text,status text NOT NULL DEFAULT 'creating'
 CHECK(status IN ('creating','open','claimed','escalated','closed','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,
 PRIMARY KEY(guild_id,ticket_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_one_active_ticket ON platform_ticket_channels(guild_id,creator_id,panel_id)
 WHERE status IN ('creating','open','claimed','escalated','uncertain');
CREATE TABLE IF NOT EXISTS platform_member_profiles(
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),user_id text NOT NULL,
 xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0),last_message_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS platform_xp_events(
 guild_id text NOT NULL,user_id text NOT NULL,event_id text NOT NULL,source text NOT NULL,
 amount integer NOT NULL CHECK(amount>0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,event_id),FOREIGN KEY(guild_id,user_id) REFERENCES platform_member_profiles(guild_id,user_id)
);
CREATE INDEX IF NOT EXISTS platform_xp_member_time ON platform_xp_events(guild_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS platform_ai_periods(
 guild_id text NOT NULL REFERENCES platform_guilds(guild_id),period date NOT NULL,
 requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),
 input_tokens bigint NOT NULL DEFAULT 0,output_tokens bigint NOT NULL DEFAULT 0,
 missing_usage integer NOT NULL DEFAULT 0,latency_ms bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(guild_id,period)
);
