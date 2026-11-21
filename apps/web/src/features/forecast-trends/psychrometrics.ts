// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
/**
 * Derived indoor-air diagnostics from DHT11 temperature and relative humidity.
 * Magnus saturation vapor pressure approximation over liquid water.  This is
 * not a measurement of water flow, room ventilation or wall condensation.
 */
const SATURATION_A = 17.62;
const SATURATION_B = 243.12;

function validTemperature(value: number): boolean {
  return Number.isFinite(value) && value >= -40 && value <= 80;
}

export function saturationAbsoluteHumidity(temperatureC: number): number | null {
  if (!validTemperature(temperatureC)) return null;
  const saturationHpa = 6.112 * Math.exp(SATURATION_A * temperatureC / (SATURATION_B + temperatureC));
  return 216.7 * saturationHpa / (temperatureC + 273.15);
}

/** Water-vapor mass per volume, g/m³. RH is expressed as 0–100 percent. */
export function absoluteHumidity(temperatureC: number, relativeHumidity: number): number | null {
  if (!Number.isFinite(relativeHumidity) || relativeHumidity < 0 || relativeHumidity > 100) return null;
  const saturated = saturationAbsoluteHumidity(temperatureC);
  return saturated === null ? null : saturated * relativeHumidity / 100;
}

export function relativeHumidityFromAbsolute(temperatureC: number, absoluteHumidityGm3: number): number | null {
  if (!Number.isFinite(absoluteHumidityGm3) || absoluteHumidityGm3 < 0) return null;
  const saturated = saturationAbsoluteHumidity(temperatureC);
  return saturated === null || saturated <= 0 ? null : Math.max(0, Math.min(100, absoluteHumidityGm3 / saturated * 100));
}

/** Calculated dew point, °C, for 0 < RH <= 100. */
export function dewPoint(temperatureC: number, relativeHumidity: number): number | null {
  if (!validTemperature(temperatureC) || !Number.isFinite(relativeHumidity) || relativeHumidity <= 0 || relativeHumidity > 100) return null;
  const gamma = Math.log(relativeHumidity / 100) + SATURATION_A * temperatureC / (SATURATION_B + temperatureC);
  const result = SATURATION_B * gamma / (SATURATION_A - gamma);
  return Number.isFinite(result) ? result : null;
}
