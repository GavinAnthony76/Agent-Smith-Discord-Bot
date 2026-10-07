CREATE TABLE IF NOT EXISTS feed_sources(
 guild_id text NOT NULL, feed_id text NOT NULL CHECK(feed_id ~ '^[a-z0-9-]{1,40}$'),
 url text NOT NULL CHECK(length(url)<=2048),
 destination text NOT NULL CHECK(destination IN ('faith-news','gaming-news','tech-news')),
 enabled boolean NOT NULL DEFAULT false, approved_by text, approved_at timestamptz,
 discussion_threads boolean NOT NULL DEFAULT false,
 interval_minutes integer NOT NULL DEFAULT 15 CHECK(interval_minutes BETWEEN 5 AND 1440),
 next_poll_at timestamptz NOT NULL DEFAULT now(), last_poll_at timestamptz,
 last_success_at timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,feed_id), CHECK(NOT enabled OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS feed_deliveries(
 delivery_id bigserial UNIQUE NOT NULL,
 guild_id text NOT NULL, feed_id text NOT NULL, item_id text NOT NULL,
 link text NOT NULL, title text NOT NULL, content text NOT NULL, channel_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('sending','uncertain','delivered','skipped')),
 message_id text, thread_id text, thread_state text NOT NULL DEFAULT 'disabled'
 CHECK(thread_state IN ('disabled','pending','creating','created','uncertain','permission-denied')),
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(guild_id,feed_id,item_id), UNIQUE(guild_id,feed_id,link),
 FOREIGN KEY(guild_id,feed_id) REFERENCES feed_sources(guild_id,feed_id)
);
CREATE INDEX IF NOT EXISTS feed_sources_due ON feed_sources(guild_id,next_poll_at) WHERE enabled;
