CREATE TABLE web_push_subscriptions (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  endpoint_hash TEXT NOT NULL UNIQUE, endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, vapid_public_key TEXT NOT NULL,
  include_simulators BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE web_push_deliveries (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  subscription_id UUID NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','expired','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  lease_until TIMESTAMPTZ(3), lease_token UUID,
  sent_at TIMESTAMPTZ(3), last_error_code TEXT,
  UNIQUE(incident_id,severity,subscription_id)
);
CREATE INDEX web_push_deliveries_status_next_attempt_at_idx ON web_push_deliveries(status,next_attempt_at);
