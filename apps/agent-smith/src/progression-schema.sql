CREATE TABLE IF NOT EXISTS progression_balances (
  guild_id text NOT NULL, user_id text NOT NULL, framework text NOT NULL CHECK(framework IN ('Gaming','Faith','Tech')),
  xp bigint NOT NULL DEFAULT 0 CHECK(xp >= 0 AND xp <= 9007199254740991),
  faith_approved integer NOT NULL DEFAULT 2 CHECK(faith_approved BETWEEN 1 AND 7),
  displayed_level integer NOT NULL DEFAULT 0, announced_level integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(guild_id,user_id,framework)
);
CREATE TABLE IF NOT EXISTS progression_events (
  id bigserial PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL, framework text NOT NULL,
  idempotency_key text NOT NULL, source text NOT NULL, actor text NOT NULL, amount bigint NOT NULL,
  reason text NOT NULL, outcome text NOT NULL, local_day text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(guild_id,user_id,framework,idempotency_key)
);
CREATE INDEX IF NOT EXISTS progression_event_limits ON progression_events(guild_id,user_id,framework,source,created_at);
CREATE TABLE IF NOT EXISTS progression_faith_reviews (
  id bigserial PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL, level integer NOT NULL CHECK(level BETWEEN 3 AND 7),
  status text NOT NULL DEFAULT 'pending', reviewer text, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, UNIQUE(guild_id,user_id,level)
);
CREATE TABLE IF NOT EXISTS progression_jobs (
  guild_id text NOT NULL, user_id text NOT NULL, framework text NOT NULL,
  revision bigint NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0, next_try timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,user_id,framework)
);
CREATE TABLE IF NOT EXISTS progression_announcements (
  id bigserial PRIMARY KEY, guild_id text NOT NULL, user_id text NOT NULL, framework text NOT NULL,
  level integer NOT NULL, status text NOT NULL DEFAULT 'pending', message_id text,
  attempts integer NOT NULL DEFAULT 0, next_try timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(guild_id,user_id,framework,level)
);
CREATE TABLE IF NOT EXISTS progression_legacy_review (
  guild_id text NOT NULL, user_id text NOT NULL, legacy_xp bigint NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'ambiguous', resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(guild_id,user_id)
);
