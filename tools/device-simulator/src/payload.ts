import type { Telemetry } from '@iot/contracts';

export function buildPayload(options: {
  deviceId: string;
  bootId: string;
  bootCounter: string;
  seq: string;
  uptime: number;
  now: Date;
  scenario?: 'normal' | 'danger';
}): Telemetry {
  // Scripted demonstration only: never infer hazard or PPM from ADC values.
  // Ten-sample cycle: 1–2 normal, 3–6 active, 7–10 recovered.
  const phase = Number((BigInt(options.seq) - 1n) % 10n) + 1;
  const dangerScenario = options.scenario === 'danger';
  const active = dangerScenario && phase >= 3 && phase <= 6;
  const wave = Math.sin(Number(BigInt(options.seq) % 100n) / 10);
  const gas = (adc: number) => ({
    adc_raw: adc,
    adc_bits: 12,
    adc_pin_mv: Math.round(adc * 0.6),
    quality: 'uncalibrated' as const,
    age_ms: 0,
    concentration_ppm: null,
  });
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
        time_quality: 'synced',
        firmware_version: 'simulator-0.1.0',
        config_version: 1,
        sensors: {
          dht11: {
            temperature_c: Math.round((27 + wave) * 10) / 10,
            humidity_pct: Math.round(65 + 3 * wave),
            quality: 'valid',
            age_ms: 0,
          },
          mq2: gas(Math.round(1200 + 100 * wave)),
          mq7: { ...gas(Math.round(900 + 80 * wave)), heater_control: 'unverified' },
          flame: { detected: active, quality: 'valid', age_ms: 0 },
        },
        alert_snapshot: {
          gas: dangerScenario ? (active ? 'active' : 'normal') : 'not_configured',
          co: dangerScenario ? (active ? 'active' : 'normal') : 'not_configured',
          flame: active ? 'active' : 'normal',
          buzzer_commanded_on: active,
        },
      },
    ],
  };
}
