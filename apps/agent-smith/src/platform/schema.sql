-- Additive platform foundation. Apply to development explicitly.
-- Never run this file from bot startup or a production build.
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
