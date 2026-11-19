import { describe, expect, it } from "vitest";
import { SCENARIOS, scenarioState } from "./scenarios.js";

describe("simulator scenarios", () => {
  it.each(SCENARIOS)(
    "%s remains inside DHT11 and 12-bit ADC contracts",
    (scenario) => {
      for (let sample = 0; sample < 60; sample += 1) {
        const state = scenarioState({
          scenario,
          sample,
          durationSamples: 60,
          seed: 7,
        });
        expect(state.temperatureC).toBeGreaterThanOrEqual(-40);
        expect(state.temperatureC).toBeLessThanOrEqual(125);
        expect(state.humidityPct).toBeGreaterThanOrEqual(0);
        expect(state.humidityPct).toBeLessThanOrEqual(100);
        expect(state.mq2Adc).toBeGreaterThanOrEqual(0);
        expect(state.mq2Adc).toBeLessThan(4096);
        expect(state.mq7Adc).toBeGreaterThanOrEqual(0);
        expect(state.mq7Adc).toBeLessThan(4096);
      }
    },
  );

  it("models baseline, ramp-up, peak, recovery and stabilization deterministically", () => {
    const points = [0, 12, 27, 42, 56].map((sample) =>
      scenarioState({
        scenario: "combined",
        sample,
        durationSamples: 60,
        seed: 2,
      }),
    );
    expect(points.map((point) => point.phase)).toEqual([
      "Baseline",
      "Ramp-up",
      "Peak",
      "Recovery",
      "Stabilization",
    ]);
    expect(points[2]!.temperatureC).toBeGreaterThan(points[0]!.temperatureC);
    expect(points[2]!.mq2Adc).toBeGreaterThan(points[0]!.mq2Adc);
    expect(points[4]!.mq2Adc).toBeLessThan(points[2]!.mq2Adc);
    expect(scenarioState({ scenario: "gas", sample: 27 }).mq7Adc).toBeLessThan(
      1200,
    );
    expect(scenarioState({ scenario: "co", sample: 27 }).mq2Adc).toBeLessThan(
      1500,
    );
  });
});
