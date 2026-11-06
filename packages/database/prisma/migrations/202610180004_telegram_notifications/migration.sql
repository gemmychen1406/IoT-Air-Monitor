CREATE TABLE telegram_notifications (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','expired','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  lease_until TIMESTAMPTZ(3), lease_token UUID,
  sent_at TIMESTAMPTZ(3), last_error_code TEXT
);
CREATE UNIQUE INDEX telegram_notifications_incident_id_severity_key ON telegram_notifications(incident_id,severity);
CREATE INDEX telegram_notifications_status_next_attempt_at_idx ON telegram_notifications(status,next_attempt_at);
