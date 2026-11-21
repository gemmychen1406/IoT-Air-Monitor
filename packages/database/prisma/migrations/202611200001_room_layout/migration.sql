BEGIN;
ALTER TABLE monitoring_rooms ADD COLUMN layout_version integer NOT NULL DEFAULT 0;
CREATE FUNCTION bump_room_layout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE monitoring_rooms SET layout_version = layout_version + 1 WHERE id = OLD.room_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.room_id <> NEW.room_id) THEN
    UPDATE monitoring_rooms SET layout_version = layout_version + 1 WHERE id = NEW.room_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER room_layout_changed AFTER INSERT OR UPDATE OR DELETE ON device_room_assignments
FOR EACH ROW EXECUTE FUNCTION bump_room_layout();
COMMIT;
