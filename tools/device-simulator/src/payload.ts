import type { Telemetry } from "@iot/contracts";
import { scenarioState, type Scenario } from "./scenarios.js";
import type { ReplayValues } from './replay.js';

export function buildPayload(options: {
  deviceId: string;
  bootId: string;
  bootCounter: string;
  seq: string;
  uptime: number;
  now: Date;
  sample?: ReplayValues;
  scenario?: Scenario;
  scenarioSample?: number;
  durationSamples?: number;
  amplitude?: number;
  seed?: number;
}): Telemetry {
  const scenario = options.scenario ?? "normal";
  // Preserve the original public helper behavior used by integration tests:
  // danger samples 3-6 are active and sample 7 starts recovery. The CLI passes
  // an explicit scenarioSample/durationSamples and therefore uses all five new phases.
  const legacyDangerPhase = Number((BigInt(options.seq) - 1n) % 10n) + 1;
  const legacyDangerSample =
    legacyDangerPhase <= 2 ? 0 : legacyDangerPhase <= 6 ? 5 : 9;
  const state = scenarioState({
    scenario,
    sample:
      options.scenarioSample ??
      (scenario === "danger"
        ? legacyDangerSample
        : Number(BigInt(options.seq) - 1n)),
    durationSamples:
      options.durationSamples ?? (scenario === "danger" ? 10 : undefined),
    amplitude: options.amplitude,
    seed: options.seed,
  });
  const gas = (adc: number) => ({
    adc_raw: adc,
    adc_bits: 12,
    adc_pin_mv: Math.round(adc * 0.6),
    quality: "uncalibrated" as const,
    age_ms: 0,
    concentration_ppm: null,
  });
  const flame = options.sample ? options.sample.flame === 'active' : state.flame;
  const wave = Math.sin(Number(BigInt(options.seq) % 100n) / 10);
  const gasActive =
    ["gas", "fire", "combined", "danger"].includes(scenario) && state.alert;
  const coActive =
    ["co", "combined", "danger"].includes(scenario) && state.alert;
  return {
    schema_version: 1,
    device_id: options.deviceId,
    transmission: {
      current_boot_id: options.bootId,
      current_boot_counter: options.bootCounter,
      sent_uptime_ms: String(options.uptime),
    },
    readings: [
      {
        boot_id: options.bootId,
        boot_counter: options.bootCounter,
        seq: options.seq,
        sampled_at: options.now.toISOString(),
        uptime_ms: String(options.uptime),
        time_quality: "synced",
        firmware_version: "simulator-0.1.0",
        config_version: 1,
        sensors: {
          dht11: {
            temperature_c: options.sample?.temperature_c ?? state.temperatureC,
            humidity_pct: options.sample?.humidity_pct ?? state.humidityPct,
            quality: "valid",
            age_ms: 0,
          },
          mq2: gas(options.sample ? Math.round(1200 + 100 * wave) : state.mq2Adc),
          mq7: { ...gas(options.sample ? Math.round(900 + 80 * wave) : state.mq7Adc), heater_control: "unverified" },
          flame: { detected: flame, quality: "valid", age_ms: 0 },
        },
        alert_snapshot: {
          gas: options.sample?.gas ?? (
            scenario === "normal"
              ? "not_configured"
              : gasActive
                ? "active"
                : "normal"),
          co:
            scenario === "normal"
              ? "not_configured"
              : coActive
                ? "active"
                : "normal",
          flame: flame ? "active" : "normal",
          buzzer_commanded_on: options.sample ? flame : flame || gasActive || coActive,
        },
      },
    ],
  };
}
