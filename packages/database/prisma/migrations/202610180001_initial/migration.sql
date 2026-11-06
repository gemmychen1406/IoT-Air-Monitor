CREATE TYPE "Role" AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE "SourceKind" AS ENUM ('physical', 'simulator');

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY, "email" TEXT NOT NULL, "password_hash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'viewer', "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "token_hash" TEXT NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

CREATE TABLE "devices" (
  "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "source_kind" "SourceKind" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3), "latest_id" BIGINT, "boot_id" UUID,
  "boot_counter" BIGINT, "latest_seq" BIGINT
);

CREATE TABLE "device_credentials" (
  "id" UUID PRIMARY KEY, "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "key_id" TEXT NOT NULL, "secret_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revoked_at" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "device_credentials_key_id_key" ON "device_credentials"("key_id");
CREATE INDEX "device_credentials_device_id_idx" ON "device_credentials"("device_id");

CREATE TABLE "sensor_readings" (
  "id" BIGSERIAL PRIMARY KEY,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "boot_id" UUID NOT NULL, "boot_counter" BIGINT NOT NULL, "seq" BIGINT NOT NULL,
  "sampled_at" TIMESTAMPTZ(3), "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "temperature_c" REAL, "humidity_pct" REAL, "mq2_adc" INTEGER, "mq7_adc" INTEGER, "flame" BOOLEAN,
  "payload" JSONB NOT NULL, "payload_hash" TEXT NOT NULL,
  CONSTRAINT "humidity_range" CHECK ("humidity_pct" BETWEEN 0 AND 100),
  CONSTRAINT "counter_range" CHECK ("seq" >= 0 AND "boot_counter" >= 0),
  CONSTRAINT "adc_range" CHECK ("mq2_adc" BETWEEN 0 AND 65535 AND "mq7_adc" BETWEEN 0 AND 65535)
);
CREATE UNIQUE INDEX "sensor_readings_device_id_boot_id_seq_key" ON "sensor_readings"("device_id", "boot_id", "seq");
CREATE INDEX "sensor_readings_device_id_sampled_at_id_idx" ON "sensor_readings"("device_id", "sampled_at" DESC, "id" DESC);
CREATE INDEX "sensor_readings_device_id_received_at_id_idx" ON "sensor_readings"("device_id", "received_at" DESC, "id" DESC);
