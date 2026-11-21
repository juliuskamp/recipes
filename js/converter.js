/**
 * Unit conversion lookup tables for cooking measurements.
 * Supports Imperial <-> Metric conversion.
 */
const Converter = (() => {
  // Conversion factors: multiply imperial amount by factor to get metric
  const toMetric = {
    cups: { unit: "ml", factor: 236.588 },
    cup: { unit: "ml", factor: 236.588 },
    oz: { unit: "g", factor: 28.3495 },
    lb: { unit: "g", factor: 453.592 },
    floz: { unit: "ml", factor: 29.5735 },
    qt: { unit: "ml", factor: 946.353 },
    gal: { unit: "l", factor: 3.785 },
    pint: { unit: "ml", factor: 473.176 },
    in: { unit: "cm", factor: 2.54 },
  };

  const toImperial = {
    ml: { unit: "floz", factor: 1 / 29.5735 },
    l: { unit: "qt", factor: 1.05669 },
    g: { unit: "oz", factor: 1 / 28.3495 },
    kg: { unit: "lb", factor: 2.20462 },
    mm: { unit: "in", factor: 1 / 25.4 },
    cm: { unit: "in", factor: 1 / 2.54 },
  };

  // Inches are given in eighths (as US recipes do), never less than ⅛.
  function roundInches(amount) {
    return Math.max(1 / 8, Math.round(amount * 8) / 8);
  }

  // Units that don't convert (counts, pinches, etc.)
  const noConvert = new Set([
    "whole", "piece", "pieces", "pinch", "bunch", "clove", "cloves",
    "tbsp", "tsp",
    "slice", "slices", "can", "cans", "package", "packages",
    "stick", "sticks", "head", "heads", "sprig", "sprigs",
  ]);

  function isMetricUnit(unit) {
    return unit in toImperial || ["ml", "l", "g", "kg"].includes(unit);
  }

  function isImperialUnit(unit) {
    return unit in toMetric;
  }

  // Temperature units convert via a formula, not a multiplicative factor,
  // and never scale with serving size (handled in the parser).
  function isTemperature(unit) {
    const u = unit.toLowerCase();
    return u === "°c" || u === "°f";
  }

  /**
   * Convert an amount from one system to the other.
   * Returns { amount, unit } or null if no conversion applies.
   */
  function convert(amount, unit, targetSystem) {
    const lowerUnit = unit.toLowerCase();

    // Temperature: Celsius <-> Fahrenheit (non-linear, no scaling)
    if (lowerUnit === "°c") {
      if (targetSystem === "imperial") return { amount: amount * 9 / 5 + 32, unit: "°F" };
      return null;
    }
    if (lowerUnit === "°f") {
      if (targetSystem === "metric") return { amount: (amount - 32) * 5 / 9, unit: "°C" };
      return null;
    }

    if (noConvert.has(lowerUnit)) return null;

    if (targetSystem === "metric" && toMetric[lowerUnit]) {
      const conv = toMetric[lowerUnit];
      return { amount: amount * conv.factor, unit: conv.unit };
    }

    if (targetSystem === "imperial" && toImperial[lowerUnit]) {
      const conv = toImperial[lowerUnit];
      const converted = amount * conv.factor;
      return { amount: conv.unit === "in" ? roundInches(converted) : converted, unit: conv.unit };
    }

    return null;
  }

  /**
   * Round a number so that its third significant digit (ignoring leading zeros)
   * is rounded to the nearest 0 or 5.
   * E.g. 3.5 -> 3.5, 104 -> 105, 236 -> 235, 1.33 -> 1.35, 0.0237 -> 0.024
   */
  function niceRound(num) {
    if (num === 0) return 0;

    const abs = Math.abs(num);
    const sign = num < 0 ? -1 : 1;

    // Shift so the number has 3 significant digits before the decimal point
    // e.g. 236 -> 236, 3.5 -> 350, 0.0237 -> 237
    // Then round last digit to nearest 0 or 5, shift back
    const mag = Math.pow(10, Math.floor(Math.log10(abs)) - 2);
    const shifted = abs / mag; // now in range [100, 1000)
    const rounded = Math.round(shifted / 5) * 5;

    return sign * rounded * mag;
  }

  // Unicode fraction characters for clean display
  const FRACTIONS = {
    0.25: "\u00BC",   // ¼
    0.5: "\u00BD",   // ½
    0.75: "\u00BE",   // ¾
    0.125: "\u215B",  // ⅛
    0.375: "\u215C",  // ⅜
    0.625: "\u215D",  // ⅝
    0.875: "\u215E",  // ⅞
    [1 / 3]: "\u2153", // ⅓
    [2 / 3]: "\u2154", // ⅔
  };

  /**
   * Try to represent a number using Unicode fraction characters.
   * Returns the formatted string or null if no clean fraction applies.
   */
  function asFraction(num, tolerance = 0.001) {
    const whole = Math.floor(num);
    const frac = num - whole;

    // Check if the fractional part matches a known fraction (within small tolerance)
    for (const [val, char] of Object.entries(FRACTIONS)) {
      if (Math.abs(frac - parseFloat(val)) < tolerance) {
        return whole > 0 ? `${whole}${char}` : char;
      }
    }
    return null;
  }

  /**
   * Format a number for display: round to nearest 5%, use fraction characters
   * where possible, strip trailing zeros otherwise.
   */
  function formatAmount(num) {
    if (num === 0) return "0";

    // Small values that are already an exact clean fraction (e.g. 1⅛ in) are
    // shown as-is; niceRound would otherwise turn 1.125 into 1.15.
    if (Math.abs(num) < 10) {
      const exact = asFraction(num, 1e-6);
      if (exact) return exact;
    }

    const rounded = niceRound(num);

    // Try Unicode fractions first
    const frac = asFraction(rounded);
    if (frac) return frac;

    // Determine decimal places from the step size
    const abs = Math.abs(rounded);
    if (abs >= 1 && Number.isInteger(rounded)) return rounded.toString();

    // Show enough decimals to represent the rounded value
    const str = rounded.toPrecision(3);
    return parseFloat(str).toString();
  }

  /**
   * Full display pipeline for one instruction measurement, shared by the build
   * (parser.js) and client-side re-rendering (runtime.js) so they cannot drift:
   * scale (unless fixed/temperature) → convert → round step → format → translate unit.
   * `m` is { amount, amountTo, unit, fixed, round }; amountTo marks a range
   * ("2-3 mm"), whose ends go through the pipeline independently.
   */
  function formatMeasurement(m, ratio, unitSystem, translateUnit) {
    const scale = !m.fixed && !(m.unit && isTemperature(m.unit));
    const values = m.amountTo != null ? [m.amount, m.amountTo] : [m.amount];
    let unit = m.unit || null;

    const formatted = values.map((value) => {
      let amount = scale ? Scaler.scaleAmount(value, ratio) : value;
      if (m.unit && unitSystem) {
        const converted = convert(amount, m.unit, unitSystem);
        if (converted) {
          amount = converted.amount;
          unit = converted.unit;
        }
      }
      if (m.round) amount = Math.round(amount / m.round) * m.round;
      return formatAmount(amount);
    });

    // A range whose ends round to the same value (2–3 mm → ⅛ in) shows once.
    const text = formatted[0] === formatted[1] ? formatted[0] : formatted.join("\u2013");
    const displayUnit = unit && translateUnit ? translateUnit(unit) : unit;
    return displayUnit ? `${text} ${displayUnit}` : text;
  }

  return { convert, formatAmount, formatMeasurement, isMetricUnit, isImperialUnit, isTemperature, noConvert };
})();
