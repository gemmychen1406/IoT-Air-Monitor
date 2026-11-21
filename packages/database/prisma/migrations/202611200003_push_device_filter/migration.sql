ALTER TABLE web_push_subscriptions ADD COLUMN sensor_ids uuid[] NOT NULL DEFAULT '{}';
