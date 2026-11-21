BEGIN;
ALTER TABLE web_push_subscriptions ADD COLUMN browser_hash text UNIQUE;
ALTER TABLE telegram_notifications ADD COLUMN round integer NOT NULL DEFAULT 0;
ALTER TABLE web_push_deliveries ADD COLUMN round integer NOT NULL DEFAULT 0;
ALTER TABLE alert_deliveries ADD COLUMN round integer NOT NULL DEFAULT 0, ADD COLUMN target_id uuid;
DROP INDEX telegram_notifications_incident_id_severity_key;
CREATE UNIQUE INDEX telegram_notifications_incident_id_severity_round_key ON telegram_notifications(incident_id,severity,round);
ALTER TABLE web_push_deliveries DROP CONSTRAINT web_push_deliveries_incident_id_severity_subscription_id_key;
ALTER TABLE web_push_deliveries ADD CONSTRAINT push_delivery_round_key UNIQUE(incident_id,severity,subscription_id,round);
UPDATE alert_deliveries h SET target_id=d.subscription_id FROM web_push_deliveries d WHERE h.channel='webpush' AND h.job_id=d.id;
CREATE FUNCTION identify_delivery_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel='webpush' THEN
    SELECT d.subscription_id,d.round INTO NEW.target_id,NEW.round FROM web_push_deliveries d WHERE d.id=NEW.job_id;
  ELSE
    SELECT d.round INTO NEW.round FROM telegram_notifications d WHERE d.id=NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_target BEFORE INSERT ON alert_deliveries FOR EACH ROW EXECUTE FUNCTION identify_delivery_target();
COMMIT;
