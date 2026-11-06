export function samplePayload() {
  return {
    schema_version: 1,
    device_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transmission: {
      current_boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      current_boot_counter: '1',
      sent_uptime_ms: '5000',
    },
    readings: [
      {
        boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        boot_counter: '1',
        seq: '1',
        sampled_at: '2026-10-18T08:00:00.000Z' as string | null,
        uptime_ms: '5000',
        time_quality: 'synced',
        firmware_version: 'simulator-0.1.0',
        config_version: 1,
        sensors: {
          dht11: {
            temperature_c: 27 as number | null,
            humidity_pct: 65 as number | null,
            quality: 'valid',
            age_ms: 0,
          },
          mq2: {
            adc_raw: 1250 as number | null,
            adc_bits: 12,
            adc_pin_mv: 740 as number | null,
            quality: 'uncalibrated',
            age_ms: 0,
            concentration_ppm: null as number | null,
          },
          mq7: {
            adc_raw: 1100 as number | null,
            adc_bits: 12,
            adc_pin_mv: 650 as number | null,
            quality: 'uncalibrated',
            age_ms: 0,
            concentration_ppm: null as number | null,
            heater_control: 'unverified',
          },
          flame: { detected: false as boolean | null, quality: 'valid', age_ms: 0 },
        },
        alert_snapshot: {
          gas: 'not_configured',
          co: 'not_configured',
          flame: 'normal',
          buzzer_commanded_on: false,
        },
      },
    ],
  };
}
