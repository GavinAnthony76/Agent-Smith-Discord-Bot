CREATE TABLE IF NOT EXISTS conversation_budget_settings (
  guild_id text PRIMARY KEY,
  request_limit integer NOT NULL CHECK(request_limit BETWEEN 0 AND 1000000),
  token_limit integer NOT NULL CHECK(token_limit BETWEEN 0 AND 1000000000),
  timezone text NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_budget_periods (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL REFERENCES conversation_budget_settings(guild_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  accounting_blocked boolean NOT NULL DEFAULT false,
  UNIQUE(id,guild_id),
  CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS conversation_budget_periods_guild_end
  ON conversation_budget_periods(guild_id,ends_at DESC);
CREATE TABLE IF NOT EXISTS conversation_budget_reservations (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  period_id uuid NOT NULL,
  charged_tokens bigint NOT NULL CHECK(charged_tokens>=0),
  reserved_tokens bigint NOT NULL CHECK(reserved_tokens>=0),
  measured_tokens bigint CHECK(measured_tokens>=0),
  settled_at timestamptz,
  FOREIGN KEY(period_id,guild_id) REFERENCES conversation_budget_periods(id,guild_id)
);
CREATE INDEX IF NOT EXISTS conversation_budget_reservations_period
  ON conversation_budget_reservations(guild_id,period_id);
