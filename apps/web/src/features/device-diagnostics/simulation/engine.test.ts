import { expect, it } from "vitest";
import { evolve, interpolate } from "./engine.js";
it("reproduces observations, keeps IDW within observed range, masks unsupported cells", () => {
  const points = [
    { id: "a", name: "A", x: 0, y: 0, value: 20 },
    { id: "b", name: "B", x: 0.5, y: 0, value: 80 },
  ];
  const grid = interpolate(points, 11, 0.2);
  expect(grid[0]).toBe(20);
  expect(grid[5]).toBe(80);
  expect(grid[120]).toBe(-1);
  expect(
    Array.from(grid)
      .filter((v) => v >= 0)
      .every((v) => v >= 20 && v <= 80),
  ).toBe(true);
});
it("has a stable nonnegative scheme, stops emitting when off and ventilation decreases signal", () => {
  const size = 24;
  const options = {
    size,
    steps: 200,
    source: true,
    ventilation: 0,
    airflow: 1,
    x: 0.3,
    y: 0.5,
    strength: 100,
  };
  const emitted = evolve(new Float32Array(size * size), options);
  expect(
    Array.from(emitted).every((v) => Number.isFinite(v) && v >= 0 && v <= 100),
  ).toBe(true);
  const sum = (g: Float32Array) => Array.from(g).reduce((a, b) => a + b, 0);
  expect(sum(emitted)).toBeGreaterThan(0);
  const without = evolve(emitted, {
    ...options,
    source: false,
    ventilation: 0,
    airflow: 0,
  });
  const ventilated = evolve(emitted, {
    ...options,
    source: false,
    ventilation: 3,
    airflow: 0,
  });
  expect(sum(ventilated)).toBeLessThan(sum(without));
  expect(
    sum(evolve(new Float32Array(size * size), { ...options, source: false })),
  ).toBe(0);
});
