ALTER TABLE monitoring_areas
  ADD COLUMN map_temperature_c DOUBLE PRECISION NOT NULL DEFAULT 30
    CHECK (map_temperature_c BETWEEN -40 AND 125),
  ADD COLUMN map_humidity_pct DOUBLE PRECISION NOT NULL DEFAULT 75
    CHECK (map_humidity_pct BETWEEN 0 AND 100);

ALTER TABLE device_room_assignments
  ADD COLUMN x DOUBLE PRECISION,
  ADD COLUMN y DOUBLE PRECISION,
  ADD CONSTRAINT device_room_assignments_position_pair_check CHECK (
    (x IS NULL AND y IS NULL) OR
    (x IS NOT NULL AND y IS NOT NULL AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1)
  );
