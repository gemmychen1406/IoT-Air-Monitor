import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { telemetrySchema } from "@iot/contracts";
import { z } from "zod";
import { buildPayload } from "./payload.js";

import catalog from "./house-stations.json" with { type: "json" };

const panelPort = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(
    process.argv.find((arg) => arg.startsWith("--port="))?.slice(7) ?? 5180,
  );
const panelOrigin = `http://127.0.0.1:${panelPort}`;
const api = new URL(process.env.SIM_API_URL ?? "http://127.0.0.1:4000");
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname);
if (
  (!isLocal &&
    (api.protocol !== "https:" || !process.argv.includes("--allow-remote"))) ||
  !["http:", "https:"].includes(api.protocol) ||
  api.username ||
  api.password
) {
  throw new Error(
    "Use a loopback API for local testing. Remote HTTPS requires --allow-remote.",
  );
}
const telemetryUrl = new URL("/api/v1/device/telemetry", api);
const modes = [
  "normal",
  "warming",
  "humid",
  "gas",
  "co",
  "fire",
  "offline",
  "invalid",
  "clock",
  "manual",
  "cook",
  "vent",
  "dry",
  "hold",
  "jump",
  "independent",
] as const;
const command = z
  .strictObject({
    station: z.enum(catalog.map((entry) => entry.station)),
    mode: z.enum(modes).optional(),
    reboot: z.literal(true).optional(),
    firmware: z.literal(true).optional(),
    bits: z.union([z.literal(10), z.literal(12)]).optional(),
    values: z
      .strictObject({
        temperature: z.number().min(0).max(50),
        humidity: z.number().min(0).max(100),
        mq2: z.number().int().min(0).max(4095),
        mq7: z.number().int().min(0).max(4095),
      })
      .optional(),
  })
  .refine(
    (v) =>
      [v.mode, v.reboot, v.firmware, v.bits].filter(Boolean).length === 1 &&
      (v.mode === "manual") === Boolean(v.values),
  );
type Settings = z.infer<typeof command>;
type Mode = (typeof modes)[number];
const stations = catalog.map((info, index) => ({
  ...info,
  index,
  previous: [...info.base],
  start: [...info.base],
  firmware: 1,
  bits: 12,
  id: z.uuid().parse(process.env[`SIM_${info.station}_DEVICE_ID`]),
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/)
    .parse(process.env[`SIM_${info.station}_DEVICE_KEY`]),
  mode: "normal" as Mode,
  manual: undefined as Settings["values"],
  changedAt: Date.now(),
  bootId: randomUUID(),
  bootCounter: Date.now(),
  bootAt: performance.now(),
  seq: 0,
  lastSent: null as string | null,
  status: "Chờ số đo đầu tiên",
}));
if (
  new Set(stations.map((s) => s.id)).size !== stations.length ||
  new Set(stations.map((s) => s.key)).size !== stations.length
) {
  throw new Error("Each station needs a distinct device ID and key.");
}
type Station = (typeof stations)[number];

function makePayload(station: Station, now: Date, uptime: number) {
  const payload = buildPayload({
    deviceId: station.id,
    bootId: station.bootId,
    bootCounter: String(station.bootCounter),
    uptime,
    seq: String(++station.seq),
    now,
  });
  const reading = payload.readings[0]!;
  const { sensors, alert_snapshot: alerts } = reading;
  const mode = station.mode;
  const slot = station.index % 3;
  const independent = mode === "independent";
  const wave = Math.sin(
    station.seq / (independent ? 7 + station.index * 2 : 9) + station.index,
  );
  const [temperature, humidity, mq2, mq7] = station.base;
  const elapsed = now.getTime() - station.changedAt;
  const ramp = Math.min(
    1,
    Math.max(0, elapsed - slot * 60000) / (mode === "cook" ? 1200000 : 240000),
  );
  const strength = 1 - slot * 0.23;
  const heat =
    mode === "cook" || mode === "warming"
      ? 8 * strength
      : mode === "vent"
        ? -1.5
        : 0;
  const moisture =
    mode === "cook" || mode === "humid"
      ? 20 * strength
      : mode === "dry"
        ? -12 * strength
        : mode === "vent"
          ? -4
          : 0;
  const easing = ["cook", "warming", "humid", "vent", "dry"].includes(mode);
  const blend = (initial: number, target: number) =>
    initial + (target - initial) * ramp;
  const values =
    mode === "manual"
      ? station.manual!
      : {
          temperature: easing
            ? blend(station.start[0], temperature + heat) + 0.2 * wave
            : temperature + 0.7 * wave + (mode === "jump" ? 9 : 0),
          humidity: easing
            ? blend(station.start[1], humidity + moisture) + 0.5 * wave
            : humidity + 2 * wave,
          mq2: mode === "gas" ? 3100 : Math.round(mq2 + 65 * wave),
          mq7: mode === "co" ? 2900 : Math.round(mq7 + 50 * wave),
        };
  if (mode === "hold")
    [values.temperature, values.humidity, values.mq2, values.mq7] =
      station.start;
  station.previous = [
    values.temperature,
    values.humidity,
    values.mq2,
    values.mq7,
  ];
  reading.firmware_version = "house-1." + station.firmware;
  sensors.dht11.temperature_c = Math.round(values.temperature * 10) / 10;
  sensors.dht11.humidity_pct = Math.round(values.humidity * 10) / 10;
  for (const sensor of ["mq2", "mq7"] as const) {
    sensors[sensor].adc_bits = station.bits;
    sensors[sensor].adc_raw = Math.round(
      (values[sensor] * (2 ** station.bits - 1)) / 4095,
    );
    sensors[sensor].adc_pin_mv = Math.round(values[sensor] * 0.6);
  }
  if (mode === "invalid") {
    sensors.dht11 = {
      temperature_c: null,
      humidity_pct: null,
      quality: "invalid",
      age_ms: 0,
    };
  }
  if (mode === "clock") {
    reading.time_quality = "unsynced";
    reading.sampled_at = null;
  }
  alerts.gas = mode === "gas" ? "active" : "normal";
  alerts.co = mode === "co" ? "active" : "normal";
  alerts.flame = mode === "fire" ? "active" : "normal";
  sensors.flame.detected = mode === "fire";
  alerts.buzzer_commanded_on =
    mode === "fire" || mode === "gas" || mode === "co";
  return payload;
}

async function transmit(
  station: Station,
  payload: ReturnType<typeof makePayload>,
) {
  telemetrySchema.parse(payload);
  const response = await fetch(telemetryUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `DeviceKey ${station.key}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  });
  const outcome = (await response.json()) as {
    data?: { accepted?: unknown[] };
    error?: { code?: string };
  };
  if (
    !response.ok ||
    outcome.data?.accepted?.length !== payload.readings.length
  )
    throw new Error(
      "HTTP " +
        response.status +
        " " +
        (outcome.error?.code ?? "API chưa nhận đủ mẫu"),
    );
}

async function send(station: Station) {
  if (station.mode === "offline") return;
  try {
    await transmit(
      station,
      makePayload(
        station,
        new Date(),
        Math.floor(performance.now() - station.bootAt),
      ),
    );
    station.lastSent = new Date().toISOString();
    station.status = "API đã nhận";
  } catch (error) {
    station.status =
      error instanceof Error ? error.message : "Mất kết nối tới API";
  }
}

// A separate, older boot preserves live sequence numbers during backfill.
const historyStart = Date.now() - 120 * 60000;
const historySources = stations.map((station) => ({
  ...station,
  bootId: randomUUID(),
  bootCounter: historyStart,
  seq: 0,
}));
let historyStatus = "Chưa chuẩn bị";
let historyRunning = false;
async function prepareHistory() {
  historyRunning = true;
  try {
    for (const source of historySources) {
      while (source.seq < 120) {
        const before = source.seq;
        try {
          const batch = Array.from({ length: 20 }, () => {
            const uptime = source.seq * 60000;
            return makePayload(source, new Date(historyStart + uptime), uptime);
          });
          const transmission = batch[batch.length - 1];
          transmission.readings = batch.map((p) => p.readings[0]);
          await transmit(source, transmission);
        } catch (error) {
          source.seq = before;
          throw error;
        }
        historyStatus = source.label + " · " + source.seq + "/120";
      }
    }
    historyStatus = "Đã chuẩn bị 120 phút cho 9 trạm";
  } catch (error) {
    historyStatus =
      "Chưa hoàn tất · " + (error instanceof Error ? error.message : "Lỗi API");
  } finally {
    historyRunning = false;
  }
}

const html = readFileSync(new URL("./house.html", import.meta.url));
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.headers.host !== new URL(panelOrigin).host) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "GET" && req.url === "/") {
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(html);
    return;
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        api: api.origin,
        historyStatus,
        historyRunning,
        stations: stations.map(
          ({
            station,
            label,
            mode,
            lastSent,
            status,
            base,
            room,
            bits,
            firmware,
          }) => ({
            station,
            label,
            mode,
            lastSent,
            status,
            base,
            room,
            bits,
            firmware,
          }),
        ),
      }),
    );
    return;
  }
  if (
    req.method !== "POST" ||
    req.url !== "/command" ||
    req.headers.origin !== panelOrigin ||
    req.headers["content-type"] !== "application/json"
  ) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 2048) {
        res.writeHead(413).end();
        return;
      }
    }
    const input = JSON.parse(body);
    if (z.strictObject({ history: z.literal(true) }).safeParse(input).success) {
      if (!historyRunning) void prepareHistory();
      res.writeHead(202).end();
      return;
    }
    const value = command.parse(input);
    const selected = stations.find((s) => s.station === value.station)!;
    if (value.mode) {
      selected.start = [...selected.previous];
      selected.mode = value.mode;
      selected.manual = value.values;
      selected.changedAt = Date.now();
    }
    if (value.bits) selected.bits = value.bits;
    if (value.firmware) selected.firmware++;
    if (value.reboot) {
      selected.bootId = randomUUID();
      selected.bootCounter = Math.max(Date.now(), selected.bootCounter + 1);
      selected.bootAt = performance.now();
      selected.seq = 0;
    }
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(panelPort, "127.0.0.1", resolve);
});
console.log(`Nhà mẫu: ${panelOrigin} → ${api.origin}`);
while (true) {
  const start = performance.now();
  await Promise.all(stations.map(send));
  await delay(Math.max(0, 5000 - (performance.now() - start)));
}
