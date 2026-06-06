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
  };

  const toImperial = {
    ml: { unit: "floz", factor: 1 / 29.5735 },
    l: { unit: "qt", factor: 1.05669 },
    g: { unit: "oz", factor: 1 / 28.3495 },
    kg: { unit: "lb", factor: 2.20462 },
  };

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

  /**
   * Convert an amount from one system to the other.
   * Returns { amount, unit } or null if no conversion applies.
   */
  function convert(amount, unit, targetSystem) {
    const lowerUnit = unit.toLowerCase();

    if (noConvert.has(lowerUnit)) return null;

    if (targetSystem === "metric" && toMetric[lowerUnit]) {
      const conv = toMetric[lowerUnit];
      return { amount: amount * conv.factor, unit: conv.unit };
    }

    if (targetSystem === "imperial" && toImperial[lowerUnit]) {
      const conv = toImperial[lowerUnit];
      return { amount: amount * conv.factor, unit: conv.unit };
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
    [1 / 3]: "\u2153", // ⅓
    [2 / 3]: "\u2154", // ⅔
  };

  /**
   * Try to represent a number using Unicode fraction characters.
   * Returns the formatted string or null if no clean fraction applies.
   */
  function asFraction(num) {
    const whole = Math.floor(num);
    const frac = num - whole;

    // Check if the fractional part matches a known fraction (within small tolerance)
    for (const [val, char] of Object.entries(FRACTIONS)) {
      if (Math.abs(frac - parseFloat(val)) < 0.001) {
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

  return { convert, formatAmount, isMetricUnit, isImperialUnit, noConvert };
})();
