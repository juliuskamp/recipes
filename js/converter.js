/**
 * Unit conversion lookup tables for cooking measurements.
 * Supports Imperial <-> Metric conversion.
 */
const Converter = (() => {
  // Conversion factors: multiply imperial amount by factor to get metric
  const toMetric = {
    cups:  { unit: "ml",  factor: 236.588 },
    cup:   { unit: "ml",  factor: 236.588 },
    tbsp:  { unit: "ml",  factor: 14.787 },
    tsp:   { unit: "ml",  factor: 4.929 },
    oz:    { unit: "g",   factor: 28.3495 },
    lb:    { unit: "g",   factor: 453.592 },
    floz:  { unit: "ml",  factor: 29.5735 },
    qt:    { unit: "ml",  factor: 946.353 },
    gal:   { unit: "l",   factor: 3.785 },
    pint:  { unit: "ml",  factor: 473.176 },
  };

  const toImperial = {
    ml:    { unit: "floz", factor: 1 / 29.5735 },
    l:     { unit: "qt",   factor: 1.05669 },
    g:     { unit: "oz",   factor: 1 / 28.3495 },
    kg:    { unit: "lb",   factor: 2.20462 },
  };

  // Units that don't convert (counts, pinches, etc.)
  const noConvert = new Set([
    "whole", "piece", "pieces", "pinch", "bunch", "clove", "cloves",
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
   * Round a number to the nearest "nice" step based on 5% of its value.
   * E.g. 104 -> 105, 236 -> 240, 1.33 -> 1.35
   */
  function niceRound(num) {
    if (num === 0) return 0;

    const abs = Math.abs(num);
    const rawStep = abs * 0.05;

    // Find a "nice" step: nearest value in 1, 2, 5, 10, 20, 50, ...
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let niceStep;
    if (norm < 1.5)      niceStep = 1 * mag;
    else if (norm < 3.5) niceStep = 2 * mag;
    else if (norm < 7.5) niceStep = 5 * mag;
    else                 niceStep = 10 * mag;

    return Math.round(num / niceStep) * niceStep;
  }

  /**
   * Format a number for display: round to nearest 5%, strip trailing zeros.
   */
  function formatAmount(num) {
    if (num === 0) return "0";

    const rounded = niceRound(num);

    // Determine decimal places from the step size
    const abs = Math.abs(rounded);
    if (abs >= 1 && Number.isInteger(rounded)) return rounded.toString();

    // Show enough decimals to represent the rounded value
    const str = rounded.toPrecision(3);
    return parseFloat(str).toString();
  }

  return { convert, formatAmount, isMetricUnit, isImperialUnit, noConvert };
})();
