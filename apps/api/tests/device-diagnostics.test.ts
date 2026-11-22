import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase } from "@iot/database";
import { createApp } from "../src/app.js";
import { featureFixture } from "./helpers.js";
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "read-only device diagnostics API",
  () => {
    const db = createDatabase(
      process.env.TEST_DATABASE_URL ?? "postgresql://localhost/iot_test",
    );
    const app = createApp({ db, origin: "http://localhost:5173" });
    let f: Awaited<ReturnType<typeof featureFixture>>;
    beforeAll(async () => {
      f = await featureFixture(db, app, "diagnostics");
      await request(app)
        .post("/api/v1/device/telemetry")
        .set(f.deviceHeaders)
        .send(f.payload(1, Date.now() - 10000))
        .expect(200);
    });
    afterAll(() => db.$disconnect());
    const range = () =>
      `from=${new Date(Date.now() - 3600000).toISOString()}&to=${new Date().toISOString()}`;
    it("requires authentication and lets all existing read roles inspect data", async () => {
      await request(app)
        .get(`/api/v1/devices/${f.deviceId}/diagnostics?${range()}`)
        .expect(401);
      for (const role of ["viewer", "operator", "admin"]) {
        const res = await request(app)
          .get(`/api/v1/devices/${f.deviceId}/diagnostics?${range()}`)
          .set(f.headers[role]!)
          .expect(200);
        expect(res.body.data.count).toBe(1);
        expect(res.body.data.source_kind).toBe("simulator");
      }
    });
    it("returns one current summary per station for a signed-in viewer", async () => {
      await request(app).get("/api/v1/diagnostics/summary").expect(401);
      const result = await request(app)
        .get("/api/v1/diagnostics/summary")
        .set(f.headers.viewer!)
        .expect(200);
      const rows = result.body.data.filter(
        (r: { device_id: string }) => r.device_id === f.deviceId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        source_kind: "simulator",
        room: null,
        notices: expect.any(Array),
      });
    });
    it("validates device IDs, dates, future bounds and thresholds", async () => {
      for (const suffix of [
        "&flat_minutes=0",
        "&gas_jump_pct=200",
        "&unknown=1",
      ])
        await request(app)
          .get(`/api/v1/devices/${f.deviceId}/diagnostics?${range()}${suffix}`)
          .set(f.headers.viewer!)
          .expect(422);
      await request(app)
        .get(`/api/v1/devices/not-a-uuid/diagnostics?${range()}`)
        .set(f.headers.viewer!)
        .expect(422);
      await request(app)
        .get(
          `/api/v1/devices/00000000-0000-4000-8000-000000000099/diagnostics?${range()}`,
        )
        .set(f.headers.viewer!)
        .expect(404);
      await request(app)
        .get(
          `/api/v1/devices/${f.deviceId}/diagnostics?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z`,
        )
        .set(f.headers.viewer!)
        .expect(422);
    });
    it("does not mutate measurements, configuration, incidents or audit logs", async () => {
      const counts = () =>
        Promise.all([
          db.sensorReading.count({ where: { deviceId: f.deviceId } }),
          db.deviceConfig.count({ where: { deviceId: f.deviceId } }),
          db.alertIncident.count({ where: { deviceId: f.deviceId } }),
          db.auditLog.count({ where: { deviceId: f.deviceId } }),
        ]);
      const before = await counts();
      await request(app)
        .get(`/api/v1/devices/${f.deviceId}/diagnostics?${range()}`)
        .set(f.headers.viewer!)
        .expect(200);
      expect(await counts()).toEqual(before);
    });
    it("reports rolled-up history honestly and suppresses actionable notices", async () => {
      await db.sensorRollup.create({
        data: {
          deviceId: f.deviceId,
          resolution: "minute",
          timeBasis: "received",
          metric: "temperature_c",
          bucketStart: new Date(Date.now() - 60000),
          totalCount: 10,
          validCount: 5,
          valueSum: 100,
        },
      });
      const res = await request(app)
        .get(`/api/v1/devices/${f.deviceId}/diagnostics?${range()}`)
        .set(f.headers.viewer!)
        .expect(200);
      expect(res.body.data.completeness.rolled_up).toBe(true);
      expect(res.body.data.notices).toEqual([]);
    });
  },
);
