ALTER TABLE audit_logs ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE audit_logs ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'device';
ALTER TABLE audit_logs ADD COLUMN resource_id TEXT;
UPDATE audit_logs SET resource_id = device_id::text;
CREATE INDEX audit_logs_resource_type_resource_id_id_idx ON audit_logs(resource_type, resource_id, id DESC);

CREATE TABLE sensor_rollups (
  device_id UUID NOT NULL REFERENCES devices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  resolution TEXT NOT NULL CHECK (resolution IN ('minute', 'hour')),
  time_basis TEXT NOT NULL CHECK (time_basis IN ('sampled', 'received')),
  metric TEXT NOT NULL CHECK (metric IN ('temperature_c', 'humidity_pct', 'mq2_adc', 'mq7_adc')),
  adc_bits INTEGER NOT NULL DEFAULT 0,
  bucket_start TIMESTAMPTZ(3) NOT NULL,
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  valid_count INTEGER NOT NULL CHECK (valid_count BETWEEN 0 AND total_count),
  value_sum DOUBLE PRECISION NOT NULL,
  minimum DOUBLE PRECISION, maximum DOUBLE PRECISION,
  PRIMARY KEY (device_id, resolution, time_basis, metric, adc_bits, bucket_start)
);
CREATE INDEX sensor_readings_retention_idx ON sensor_readings(received_at, id);
