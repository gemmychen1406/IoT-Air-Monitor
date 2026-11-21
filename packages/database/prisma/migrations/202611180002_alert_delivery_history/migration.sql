BEGIN;

LOCK TABLE telegram_notifications, web_push_deliveries IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE users ADD COLUMN push_show_details BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE alert_deliveries (
  ordinal BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'webpush')),
  job_id UUID NOT NULL,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  recipient_user_id UUID,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL,
  accepted_at TIMESTAMPTZ(3),
  last_error_code TEXT,
  device_name TEXT,
  location TEXT,
  location_source TEXT CHECK (location_source IN ('assignment', 'device_location', 'none')),
  UNIQUE (channel, job_id)
);
CREATE INDEX alert_deliveries_recipient_user_id_ordinal_idx ON alert_deliveries(recipient_user_id, ordinal DESC);
CREATE INDEX alert_deliveries_incident_id_channel_idx ON alert_deliveries(incident_id, channel);

CREATE TABLE alert_delivery_attempts (
  delivery_ordinal BIGINT NOT NULL REFERENCES alert_deliveries(ordinal) ON DELETE CASCADE ON UPDATE CASCADE,
  number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  started_at TIMESTAMPTZ(3) NOT NULL,
  finished_at TIMESTAMPTZ(3),
  error_code TEXT,
  PRIMARY KEY (delivery_ordinal, number)
);

CREATE TABLE alert_receipts (
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source = 'web'),
  late BOOLEAN NOT NULL,
  PRIMARY KEY (incident_id, user_id)
);
CREATE INDEX alert_receipts_user_id_idx ON alert_receipts(user_id);

-- Copy surviving legacy jobs, without inventing snapshots or attempt timestamps.
INSERT INTO alert_deliveries (
  channel, job_id, incident_id, recipient_user_id, severity, status, attempts,
  created_at, next_attempt_at, accepted_at, last_error_code
)
SELECT 'telegram', id, incident_id, NULL::uuid, severity, status, attempts,
       created_at, next_attempt_at, sent_at, last_error_code
FROM telegram_notifications
UNION ALL
SELECT 'webpush', d.id, d.incident_id, se.user_id, d.severity, d.status, d.attempts,
       d.created_at, d.next_attempt_at, d.sent_at, d.last_error_code
FROM web_push_deliveries d
JOIN web_push_subscriptions s ON s.id = d.subscription_id
JOIN sessions se ON se.id = s.session_id
ORDER BY created_at;

-- The original jobs remain the only source of send work. Audit changes in the
-- same transaction, including subscription/session cascades and legacy workers.
CREATE FUNCTION mirror_airguard_alert_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  queue_channel TEXT := TG_ARGV[0];
  delivery_id BIGINT;
  owner_id UUID;
  attempt_outcome TEXT;
  reason TEXT;
  observed TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF queue_channel = 'webpush' THEN
      SELECT se.user_id INTO owner_id FROM web_push_subscriptions s
      JOIN sessions se ON se.id = s.session_id WHERE s.id = NEW.subscription_id;
    END IF;
    INSERT INTO alert_deliveries (
      channel, job_id, incident_id, recipient_user_id, severity, status, attempts,
      created_at, next_attempt_at, accepted_at, last_error_code, device_name, location, location_source
    )
    SELECT queue_channel, NEW.id, NEW.incident_id, owner_id, NEW.severity, NEW.status, NEW.attempts,
      NEW.created_at, NEW.next_attempt_at, NEW.sent_at, NEW.last_error_code, d.name,
      CASE WHEN r.id IS NOT NULL THEN a.name || ' / ' || r.name ELSE NULLIF(BTRIM(d.location), '') END,
      CASE WHEN r.id IS NOT NULL THEN 'assignment'
           WHEN NULLIF(BTRIM(d.location), '') IS NOT NULL THEN 'device_location' ELSE 'none' END
    FROM alert_incidents i
    JOIN devices d ON d.id = i.device_id
    LEFT JOIN device_room_assignments da ON da.device_id = d.id
    LEFT JOIN monitoring_rooms r ON r.id = da.room_id
    LEFT JOIN monitoring_areas a ON a.id = r.area_id
    WHERE i.id = NEW.incident_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF queue_channel = 'webpush' AND OLD.status IN ('pending', 'sending') THEN
      UPDATE alert_deliveries SET status = 'skipped', last_error_code = 'PUSH_SUBSCRIPTION_REMOVED'
      WHERE channel = queue_channel AND job_id = OLD.id RETURNING ordinal INTO delivery_id;
      UPDATE alert_delivery_attempts SET outcome = 'unknown', finished_at = observed,
        error_code = 'PUSH_SUBSCRIPTION_REMOVED'
      WHERE delivery_ordinal = delivery_id AND number = OLD.attempts AND outcome = 'sending';
    END IF;
    RETURN OLD;
  END IF;

  UPDATE alert_deliveries SET status = NEW.status, attempts = NEW.attempts,
    next_attempt_at = NEW.next_attempt_at, accepted_at = NEW.sent_at, last_error_code = NEW.last_error_code
  WHERE channel = queue_channel AND job_id = NEW.id RETURNING ordinal INTO delivery_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF OLD.status = 'sending' AND (NEW.status <> 'sending' OR NEW.attempts <> OLD.attempts) THEN
    reason := NEW.last_error_code;
    attempt_outcome := CASE NEW.status WHEN 'pending' THEN 'retry' ELSE NEW.status END;
    IF NEW.status = 'sending' THEN
      attempt_outcome := 'unknown';
      reason := 'LEASE_EXPIRED';
    ELSIF reason IN ('MAX_ATTEMPTS', 'DELIVERY_EXPIRED') OR
      (reason IN ('PUSH_AUTH_REVOKED', 'SIMULATOR_NOT_ALLOWED') AND OLD.lease_until <= observed) THEN
      attempt_outcome := 'unknown';
    END IF;
    UPDATE alert_delivery_attempts SET outcome = attempt_outcome, finished_at = observed, error_code = reason
    WHERE delivery_ordinal = delivery_id AND number = OLD.attempts AND outcome = 'sending';
  END IF;

  IF NEW.status = 'sending' AND NEW.attempts > OLD.attempts THEN
    INSERT INTO alert_delivery_attempts(delivery_ordinal, number, outcome, started_at)
    VALUES (delivery_id, NEW.attempts, 'sending', observed)
    ON CONFLICT (delivery_ordinal, number) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER telegram_delivery_history AFTER INSERT OR UPDATE OR DELETE ON telegram_notifications
FOR EACH ROW EXECUTE FUNCTION mirror_airguard_alert_delivery('telegram');
CREATE TRIGGER web_push_delivery_history AFTER INSERT OR UPDATE OR DELETE ON web_push_deliveries
FOR EACH ROW EXECUTE FUNCTION mirror_airguard_alert_delivery('webpush');

COMMIT;
