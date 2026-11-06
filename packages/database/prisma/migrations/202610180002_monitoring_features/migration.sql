ALTER TABLE devices
  ADD COLUMN location TEXT NOT NULL DEFAULT '',
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN archived_at TIMESTAMPTZ(3),
  ADD COLUMN reporting_interval_ms INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN desired_config_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN applied_config_version INTEGER,
  ADD COLUMN connectivity TEXT NOT NULL DEFAULT 'never_seen',
  ADD CONSTRAINT reporting_interval_range CHECK (reporting_interval_ms BETWEEN 1000 AND 60000);
ALTER TABLE device_credentials
  ADD COLUMN expires_at TIMESTAMPTZ(3), ADD COLUMN last_used_at TIMESTAMPTZ(3),
  ADD COLUMN label TEXT NOT NULL DEFAULT '', ADD COLUMN replaces_key_id TEXT;

CREATE TABLE alert_incidents (
  id UUID PRIMARY KEY, ordinal BIGSERIAL UNIQUE NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  external_id UUID, condition TEXT NOT NULL, severity TEXT NOT NULL, origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at TIMESTAMPTZ(3), ended_at TIMESTAMPTZ(3),
  first_observed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT incident_condition CHECK (condition IN ('gas', 'co', 'flame')),
  CONSTRAINT incident_severity CHECK (severity IN ('warning', 'critical')),
  CONSTRAINT incident_status CHECK (status IN ('active', 'ended')),
  CONSTRAINT incident_time_order CHECK (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX alert_incidents_device_id_external_id_key ON alert_incidents(device_id, external_id);
CREATE UNIQUE INDEX alert_incidents_one_open_condition ON alert_incidents(device_id, condition) WHERE status = 'active';
CREATE INDEX alert_incidents_device_id_first_observed_at_idx ON alert_incidents(device_id, first_observed_at DESC);
CREATE INDEX alert_incidents_status_ordinal_idx ON alert_incidents(status, ordinal DESC);

CREATE TABLE alert_events (
  id BIGSERIAL PRIMARY KEY, device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_event_id TEXT NOT NULL, transition TEXT NOT NULL, occurred_at TIMESTAMPTZ(3),
  received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, boot_id UUID NOT NULL,
  boot_counter BIGINT NOT NULL, seq BIGINT NOT NULL, payload_hash TEXT NOT NULL, payload JSONB NOT NULL,
  CONSTRAINT event_transition CHECK (transition IN ('started', 'ended'))
);
CREATE UNIQUE INDEX alert_events_device_id_source_event_id_key ON alert_events(device_id, source_event_id);
CREATE INDEX alert_events_incident_id_id_idx ON alert_events(incident_id, id);
CREATE INDEX alert_events_device_id_received_at_idx ON alert_events(device_id, received_at DESC);

CREATE TABLE alert_states (
  id UUID PRIMARY KEY, device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  condition TEXT NOT NULL, state TEXT NOT NULL,
  incident_id UUID REFERENCES alert_incidents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  boot_id UUID NOT NULL, boot_counter BIGINT NOT NULL, seq BIGINT NOT NULL, updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX alert_states_device_id_condition_key ON alert_states(device_id, condition);

CREATE TABLE alert_acknowledgements (
  id UUID PRIMARY KEY, incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX alert_acknowledgements_incident_id_key ON alert_acknowledgements(incident_id);

CREATE TABLE device_configs (
  id UUID PRIMARY KEY, device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  version INTEGER NOT NULL, config JSONB NOT NULL, content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX device_configs_device_id_version_key ON device_configs(device_id, version);
-- Backfill the immutable initial configuration for existing devices without touching telemetry.
-- SHA-256 of canonical JSON {"reporting_interval_ms":5000}; matches the API hash function.
INSERT INTO device_configs (id, device_id, version, config, content_hash)
SELECT gen_random_uuid(), id, 1, '{"reporting_interval_ms":5000}'::jsonb,
  encode(sha256(convert_to('{"reporting_interval_ms":5000}', 'UTF8')), 'hex') FROM devices;

CREATE TABLE device_config_acks (
  id UUID PRIMARY KEY, device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  version INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT config_ack_status CHECK (status IN ('applied', 'rejected'))
);
CREATE UNIQUE INDEX device_config_acks_device_id_version_status_key ON device_config_acks(device_id, version, status);

CREATE TABLE device_status_history (
  id BIGSERIAL PRIMARY KEY, device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  previous_status TEXT NOT NULL, new_status TEXT NOT NULL, effective_at TIMESTAMPTZ(3) NOT NULL,
  detected_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, reason TEXT NOT NULL
);
CREATE INDEX device_status_history_device_id_id_idx ON device_status_history(device_id, id DESC);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action TEXT NOT NULL, device_id UUID NOT NULL, metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_logs_device_id_id_idx ON audit_logs(device_id, id DESC);
