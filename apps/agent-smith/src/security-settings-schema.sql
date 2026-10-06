CREATE TABLE IF NOT EXISTS bot_settings (
  guild_id text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(guild_id,key)
);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE requests SET expires_at=created_at+interval '14 days' WHERE expires_at IS NULL;
CREATE INDEX IF NOT EXISTS requests_expiry ON requests(guild_id,expires_at,id) WHERE status='pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='requests_status_allowed' AND conrelid='requests'::regclass) THEN
    ALTER TABLE requests ADD CONSTRAINT requests_status_allowed
      CHECK(status IN ('pending','approved','denied','expired','withdrawn'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS request_notifications (
  request_id bigint PRIMARY KEY REFERENCES requests(id), guild_id text NOT NULL,
  user_id text NOT NULL, framework text NOT NULL,
  status text NOT NULL DEFAULT 'pending', error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
