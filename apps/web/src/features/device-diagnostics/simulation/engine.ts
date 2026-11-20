export type Point = {
  id: string;
  name: string;
  x: number;
  y: number;
  value: number;
};
export type SimulationOptions = {
  size: number;
  steps: number;
  source: boolean;
  ventilation: number;
  airflow: number;
  x: number;
  y: number;
  strength: number;
};

/** IDW is an illustrative signal surface, not a concentration or a physical dispersion model. */
export function interpolate(points: Point[], size: number, radius = 0.55) {
  const grid = new Float32Array(size * size);
  grid.fill(-1); // unsupported cells stay visibly unknown
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0,
        weights = 0,
        nearest = Infinity;
      for (const p of points) {
        const d2 = (x / (size - 1) - p.x) ** 2 + (y / (size - 1) - p.y) ** 2;
        nearest = Math.min(nearest, d2);
        if (d2 < 1e-8) {
          sum = p.value;
          weights = 1;
          break;
        }
        const weight = 1 / d2;
        sum += p.value * weight;
        weights += weight;
      }
      if (weights && nearest <= radius * radius)
        grid[y * size + x] = sum / weights;
    }
  return grid;
}

/** Explicit diffusion + upwind advection, unitless cells and steps. Coefficients obey a conservative stability bound. */
export function evolve(initial: Float32Array, options: SimulationOptions) {
  const {
    size,
    steps,
    source,
    ventilation,
    airflow,
    x: sx,
    y: sy,
    strength,
  } = options;
  let current = new Float32Array(initial);
  const diffusion = 0.12,
    vx = airflow * 0.15,
    decay = ventilation * 0.025;
  for (let step = 0; step < steps; step++) {
    const next = new Float32Array(current.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = y * size + x,
          c = current[at]!;
        const left = current[y * size + Math.max(0, x - 1)]!;
        const right = current[y * size + Math.min(size - 1, x + 1)]!;
        const up = current[Math.max(0, y - 1) * size + x]!;
        const down = current[Math.min(size - 1, y + 1) * size + x]!;
        const advection = vx >= 0 ? vx * (c - left) : vx * (right - c);
        const distance2 =
          (x / (size - 1) - sx) ** 2 + (y / (size - 1) - sy) ** 2;
        const injection = source
          ? strength * 0.025 * Math.exp(-distance2 / 0.002)
          : 0;
        next[at] = Math.max(
          0,
          Math.min(
            100,
            c +
              diffusion * (left + right + up + down - 4 * c) -
              advection -
              decay * c +
              injection,
          ),
        );
      }
    current = next;
  }
  return current;
}
