export const SCENARIOS = [
  "normal",
  "heat",
  "humidity",
  "gas",
  "co",
  "fire",
  "combined",
  "danger",
] as const;

export type Scenario = (typeof SCENARIOS)[number];
export type ScenarioPhase =
  "Baseline" | "Ramp-up" | "Peak" | "Recovery" | "Stabilization";

export type ScenarioState = {
  phase: ScenarioPhase;
  progress: number;
  temperatureC: number;
  humidityPct: number;
  mq2Adc: number;
  mq7Adc: number;
  flame: boolean;
  alert: boolean;
};

function seededNoise(seed: number, sample: number) {
  const value = Math.sin((seed + 1) * 12.9898 + sample * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function phaseAt(sample: number, durationSamples: number) {
  const position = Math.min(
    0.999999,
    Math.max(0, sample / Math.max(1, durationSamples)),
  );
  if (position < 0.15) return { phase: "Baseline" as const, level: 0 };
  if (position < 0.4)
    return { phase: "Ramp-up" as const, level: (position - 0.15) / 0.25 };
  if (position < 0.6) return { phase: "Peak" as const, level: 1 };
  if (position < 0.85)
    return { phase: "Recovery" as const, level: 1 - (position - 0.6) / 0.25 };
  return { phase: "Stabilization" as const, level: 0 };
}

export function scenarioState(options: {
  scenario: Scenario;
  sample: number;
  durationSamples?: number;
  amplitude?: number;
  seed?: number;
}): ScenarioState {
  const duration = options.durationSamples ?? 60;
  const { phase, level } = phaseAt(options.sample, duration);
  const amplitude = options.amplitude ?? 1;
  const scenario =
    options.scenario === "danger" ? "combined" : options.scenario;
  const noise = seededNoise(options.seed ?? 1, options.sample);
  const gentleWave = Math.sin(
    (options.sample / Math.max(duration, 1)) * Math.PI * 6,
  );
  const affects = (name: Scenario) =>
    scenario === name || scenario === "combined";
  const temperature =
    27 +
    gentleWave * 0.25 +
    (affects("heat") || affects("fire") ? 11 * level * amplitude : 0);
  const humidity =
    62 + gentleWave * 1.2 + (affects("humidity") ? 25 * level * amplitude : 0);
  const mq2 =
    1150 +
    gentleWave * 25 +
    noise * 12 +
    (affects("gas") || affects("fire") ? 2100 * level * amplitude : 0);
  const mq7 =
    900 +
    gentleWave * 20 +
    noise * 10 +
    (affects("co") ? 2300 * level * amplitude : 0);
  const flame = affects("fire") && level >= 0.75;
  return {
    phase,
    progress: Math.min(1, options.sample / Math.max(1, duration)),
    temperatureC:
      Math.round(Math.min(50, Math.max(-40, temperature)) * 10) / 10,
    humidityPct: Math.round(Math.min(100, Math.max(0, humidity))),
    mq2Adc: Math.round(Math.min(4095, Math.max(0, mq2))),
    mq7Adc: Math.round(Math.min(4095, Math.max(0, mq7))),
    flame,
    alert: level >= 0.75 && scenario !== "normal",
  };
}
