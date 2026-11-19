import { describe, expect, it } from "vitest";
import {
  formatSensorValue,
  RAW_ADC_NOTICE,
  validDisplayRange,
} from "./sensor-display.js";

describe("sensor display rules", () => {
  it("does not show false precision and uses a consistent missing marker", () => {
    expect(formatSensorValue("temperature_c", 27.46)).toBe("27,5");
    expect(formatSensorValue("humidity_pct", 62.4)).toBe("62");
    expect(formatSensorValue("mq2_adc", 1234.4)).toBe("1234");
    expect(formatSensorValue("mq7_adc", null)).toBe("—");
  });
  it("validates display ranges without modifying raw values or claiming calibration", () => {
    expect(validDisplayRange("humidity_pct", 101)).toBe(false);
    expect(validDisplayRange("temperature_c", 25)).toBe(true);
    expect(RAW_ADC_NOTICE).not.toMatch(/ppm.*=/i);
    expect(RAW_ADC_NOTICE).toMatch(/chưa hiệu chuẩn/i);
  });
});
