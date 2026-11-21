CREATE TABLE monitoring_areas (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE monitoring_rooms (
  id UUID PRIMARY KEY,
  area_id UUID NOT NULL REFERENCES monitoring_areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  UNIQUE (area_id, name_key)
);

CREATE TABLE device_room_assignments (
  device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  room_id UUID NOT NULL REFERENCES monitoring_rooms(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX device_room_assignments_room_id_idx ON device_room_assignments(room_id);

CREATE TABLE support_contacts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT NOT NULL CHECK (phone ~ '^[+][1-9][0-9]{6,14}$'),
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 999),
  area_id UUID REFERENCES monitoring_areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  room_id UUID REFERENCES monitoring_rooms(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  archived_at TIMESTAMPTZ(3),
  CHECK (area_id IS NULL OR room_id IS NULL)
);
CREATE INDEX support_contacts_area_id_idx ON support_contacts(area_id);
CREATE INDEX support_contacts_room_id_idx ON support_contacts(room_id);
