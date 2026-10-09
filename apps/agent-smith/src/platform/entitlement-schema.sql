-- Additive DEVELOPMENT schema. Managed production changes use Publish, not startup DDL.
CREATE TABLE IF NOT EXISTS platform_plan_assignments (
 guild_id text PRIMARY KEY,
 plan text NOT NULL CHECK (plan IN ('FREE','PRO','ULTIMATE')),
 status text NOT NULL CHECK (status IN ('ACTIVE','TRIAL','MANUAL','SUSPENDED','EXPIRED')),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,
 source text NOT NULL DEFAULT 'MANUAL_TEST',
 metadata jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,
 assigned_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_features (
 feature_key text PRIMARY KEY,
 display_name text NOT NULL,
 description text NOT NULL,
 module text NOT NULL,
 minimum_plan text CHECK (minimum_plan IN ('FREE','PRO','ULTIMATE')),
 enabled boolean NOT NULL DEFAULT true,
 configuration jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS platform_feature_policies (
 plan text NOT NULL CHECK (plan IN ('FREE','PRO','ULTIMATE')),
 feature_key text NOT NULL REFERENCES platform_features(feature_key),
 available boolean NOT NULL DEFAULT true,
 minimum_plan text CHECK (minimum_plan IN ('FREE','PRO','ULTIMATE')),
 limits jsonb NOT NULL DEFAULT '{}',
 approved boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (plan,feature_key)
);
CREATE TABLE IF NOT EXISTS platform_feature_usage (
 guild_id text NOT NULL,
 feature_key text NOT NULL REFERENCES platform_features(feature_key),
 limit_key text NOT NULL,
 period date NOT NULL,
 used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
 PRIMARY KEY (guild_id,feature_key,limit_key,period)
);
