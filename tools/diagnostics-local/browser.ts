import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import type { Database } from "@iot/database";
import { buildPayload } from "../device-simulator/src/payload.js";

export async function checkSystem(
  db: Database,
  account: { email: string; password: string },
  origin: string,
) {
  const browser = await chromium.launch({
    channel: process.env.AIRGUARD_BROWSER_CHANNEL,
  });
  try {
    const page = await browser.newPage({ baseURL: origin });
    const errors: string[] = [];
    const telemetryFrames: string[] = [];
    page.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => {
        const frame = payload.toString();
        if (frame.includes('"telemetry.created"')) telemetryFrames.push(frame);
      }),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Mật khẩu").fill(account.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByRole("heading", { name: "Tổng quan", exact: false }).first(),
    ).toBeVisible();
    async function create(path: string, data?: object) {
      const res = await page.request.post("/api/v1/" + path, {
        headers: { "X-Requested-With": "AirGuard" },
        data,
      });
      assert.ok(res.ok(), path + " HTTP " + res.status());
      return (await res.json()).data;
    }
    const device = await create("devices", {
      name: "Trạm tích hợp",
      source_kind: "simulator",
    });
    const { key } = await create(`devices/${device.id}/credentials`);
    const area = await create("spaces/areas", { name: "Khu demo" });
    const room = await create("spaces/rooms", {
      name: "Phòng tích hợp",
      area_id: area.id,
    });
    const assignment = await page.request.put(
      `/api/v1/spaces/devices/${device.id}/room`,
      {
        headers: { "X-Requested-With": "AirGuard" },
        data: { room_id: room.id },
      },
    );
    assert.ok(assignment.ok());
    assert.equal(
      (
        await db.deviceRoomAssignment.findUniqueOrThrow({
          where: { deviceId: device.id },
        })
      ).roomId,
      room.id,
    );
    const bootId = randomUUID();
    async function send(seq: number, now: Date, peak = false) {
      const payload = buildPayload({
        deviceId: device.id,
        bootId,
        bootCounter: "1",
        seq: String(seq),
        uptime: seq * 60000,
        now,
        scenario: "gas",
        scenarioSample: peak ? 5 : 0,
        durationSamples: 10,
      });
      const res = await page.request.post("/api/v1/device/telemetry", {
        headers: { Authorization: "DeviceKey " + key },
        data: payload,
      });
      assert.ok(res.ok(), "telemetry HTTP " + res.status());
      const row = await db.sensorReading.findFirstOrThrow({
        where: { deviceId: device.id, bootId, seq: BigInt(seq) },
      });
      assert.equal(row.mq2Adc, payload.readings[0]!.sensors.mq2.adc_raw);
      return String(row.mq2Adc);
    }
    const start = Date.now() - 20 * 60000;
    await page.goto("/app/monitoring/" + device.id);
    await expect(page.locator(".topbar .badge")).toHaveText("Trực tiếp");
    const panel = page.getByRole("region", { name: "Cảm biến Trạm tích hợp" });
    const first = await send(1, new Date(start));
    await expect(panel).toContainText(first);
    const second = await send(2, new Date(start + 60000), true);
    assert.notEqual(first, second);
    await expect(panel).toContainText(second);
    await expect
      .poll(
        () =>
          telemetryFrames.filter((frame) => frame.includes(device.id)).length,
      )
      .toBeGreaterThan(0);
    console.log(
      "MQ-2 trên PostgreSQL và cùng màn hình giám sát:",
      first,
      "→",
      second,
      "ADC",
    );
    const incident = await db.alertIncident.findFirstOrThrow({
      where: { deviceId: device.id, condition: "gas", status: "active" },
    });
    await page.goto("/app/alerts?device_id=" + device.id);
    await page.locator(`a[href="/app/alerts/${incident.id}"]`).click();
    await page
      .getByLabel("Ghi chú xác nhận")
      .fill("Đã kiểm tra phòng tích hợp");
    await page
      .getByRole("button", { name: "Xác nhận đã xem", exact: true })
      .click();
    await expect(page.getByText("Đã xác nhận", { exact: true })).toBeVisible();
    assert.equal(
      await db.alertAcknowledgement.count({
        where: { incidentId: incident.id },
      }),
      1,
    );
    await page.goto("/app/notifications?device_id=" + device.id);
    await expect(page.getByText("Chưa có lượt gửi phù hợp.")).toBeVisible();
    assert.equal(
      await db.alertDelivery.count({ where: { incidentId: incident.id } }),
      0,
    );
    console.log("Sự cố gas:", incident.id, "· 0 lượt gửi khi tắt kênh");
    await page.goto("/app/forecast");
    await page.locator(".ft-device-select select").selectOption(device.id);
    await page.getByRole("button", { name: "Dự báo 15–30 phút" }).click();
    await expect(
      page.getByText(/Chưa có đủ dữ liệu để trình bày/),
    ).toBeVisible();
    for (let seq = 3; seq <= 21; seq++)
      await send(seq, new Date(start + (seq - 1) * 60000));
    await page.goto("/app/device-diagnostics");
    await page.locator("select").first().selectOption(device.id);
    await expect(page.locator(".dd-snapshot")).toContainText("21 mẫu gốc");
    await page.goto("/app/comparison-reporting");
    await expect(
      page.getByRole("heading", {
        name: "Hiểu dữ liệu môi trường dễ dàng hơn",
      }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /Trạm tích hợp/ }).check();
    await page.getByRole("button", { name: "Xem kết quả" }).click();
    await expect(
      page
        .locator(".cr-summary-grid article")
        .filter({ hasText: "Trạm tích hợp" })
        .locator("strong"),
    ).toContainText(/\d/);
    await expect(page.getByLabel("Biểu đồ so sánh thiết bị")).toBeVisible();
    await page.goto("/app/forecast");
    await page.locator(".ft-device-select select").selectOption(device.id);
    await page.getByRole("button", { name: "Dự báo 15–30 phút" }).click();
    await expect(
      page.locator(".ft-metric-bottom").filter({ hasText: "Thay đổi:" }),
    ).toHaveCount(2);
    console.log(
      "DHT11 cùng thiết bị: thiếu lịch sử với 2 mẫu, dự báo nhiệt độ và độ ẩm với 21 mẫu.",
    );
    const replay = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "tools/device-simulator/src/main.ts",
        "--csv",
        "tools/device-simulator/scenarios/example.csv",
      ],
      {
        env: {
          ...process.env,
          SIM_API_URL: origin,
          SIM_DEVICE_ID: device.id,
          SIM_DEVICE_KEY: key,
        },
        timeout: 60000,
        windowsHide: true,
      },
    );
    assert.match(replay.stdout, /seq=3\b/);
    assert.equal(
      await db.sensorReading.count({ where: { deviceId: device.id } }),
      24,
    );
    console.log(
      "Simulator CLI: 3 mẫu CSV bổ sung, tổng 24 bản ghi đúng thiết bị.",
    );
    await page.goto("/app/smart-monitoring");
    await page.getByLabel("Trạm đánh giá:").selectOption(device.id);
    await expect(page.locator(".actuator-control-card")).toContainText(
      "Trạm tích hợp",
    );
    assert.deepEqual(errors, []);
    console.log("Đã xác minh trạm trên màn hình giám sát thông minh.");
  } finally {
    await browser.close();
  }
}
