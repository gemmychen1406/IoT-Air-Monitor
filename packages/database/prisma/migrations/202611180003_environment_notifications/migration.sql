CREATE TABLE environment_policies (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','webpush')),
  user_id UUID,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  CHECK ((channel = 'telegram' AND id = 'telegram' AND user_id IS NULL)
    OR (channel = 'webpush' AND user_id IS NOT NULL AND id = 'webpush:' || user_id::text))
);
CREATE TABLE environment_device_states (
  policy_id TEXT NOT NULL REFERENCES environment_policies(id) ON DELETE CASCADE ON UPDATE CASCADE,
  device_id UUID NOT NULL,
  started_at TIMESTAMPTZ(3) NOT NULL,
  last_digest_at TIMESTAMPTZ(3),
  variation_checked TIMESTAMPTZ(3),
  last_variation_at TIMESTAMPTZ(3),
  status_cursor BIGINT NOT NULL DEFAULT 0,
  offline_id BIGINT,
  offline_at TIMESTAMPTZ(3),
  offline_queued BOOLEAN NOT NULL DEFAULT false,
  last_offline_at TIMESTAMPTZ(3),
  PRIMARY KEY (policy_id, device_id)
);
CREATE TABLE environment_deliveries (
  ordinal BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  policy_id TEXT NOT NULL REFERENCES environment_policies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','webpush')),
  user_id UUID,
  device_id UUID NOT NULL,
  device_name TEXT NOT NULL,
  simulator BOOLEAN NOT NULL,
  location TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('digest','variation','offline','online')),
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  subscription_id UUID,
  depends_on UUID,
  summary TEXT NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  lease_until TIMESTAMPTZ(3),
  lease_token UUID,
  accepted_at TIMESTAMPTZ(3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','expired','skipped')),
  last_error_code TEXT,
  attempt_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT environment_deliveries_event_target_key UNIQUE (policy_id, device_id, kind, source_key, target_key)
);
CREATE INDEX environment_deliveries_channel_status_next_attempt_at_idx
  ON environment_deliveries(channel, status, next_attempt_at);
CREATE INDEX environment_deliveries_status_expires_at_idx ON environment_deliveries(status, expires_at);
CREATE INDEX environment_deliveries_policy_id_device_id_kind_occurred_at_idx
  ON environment_deliveries(policy_id, device_id, kind, occurred_at DESC);
CREATE INDEX environment_deliveries_user_id_ordinal_idx ON environment_deliveries(user_id, ordinal DESC);
