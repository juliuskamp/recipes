/**
 * Parses recipe instructions and handles the {{amount unit}} template syntax.
 */
const Parser = (() => {
  // Matches {{amount unit}} or {{amount}}
  const MEASUREMENT_RE = /\{\{([^}]+)\}\}/g;

  /**
   * Parse a single {{...}} token into { amount, unit, fixed, round }.
   * A leading ! means the amount is fixed (not scaled with servings).
   * A trailing "round <step>" means round the scaled amount to the nearest step.
   * Examples:
   *   "2 cups"         -> { amount: 2, unit: "cups" }
   *   "!2 tbsp"        -> { amount: 2, unit: "tbsp", fixed: true }
   *   "6 round 1"      -> { amount: 6, unit: null, round: 1 }
   *   "5 g round 0.5"  -> { amount: 5, unit: "g", round: 0.5 }
   *   "!2-3 mm"        -> { amount: 2, amountTo: 3, unit: "mm", fixed: true }
   */
  function parseToken(token) {
    let trimmed = token.trim();
    let fixed = false;
    if (trimmed.startsWith("!")) {
      fixed = true;
      trimmed = trimmed.slice(1).trim();
    }

    // Extract optional "round <step>" suffix
    let round = null;
    const roundMatch = trimmed.match(/\s+round\s+([0-9.]+)\s*$/);
    if (roundMatch) {
      round = parseFloat(roundMatch[1]);
      trimmed = trimmed.slice(0, roundMatch.index);
    }

    // Optional range "2-3" / "2 – 3" (hyphen or en dash)
    let amountTo = null;
    const rangeMatch = trimmed.match(/^([0-9.]+)\s*[-\u2013]\s*([0-9.]+)(?=\s|$)/);
    if (rangeMatch) {
      amountTo = parseFloat(rangeMatch[2]);
      trimmed = rangeMatch[1] + trimmed.slice(rangeMatch[0].length);
    }

    const parts = trimmed.split(/\s+/);
    const amount = parseFloat(parts[0]);
    if (isNaN(amount)) return null;

    const unit = parts.length > 1 ? parts.slice(1).join(" ") : null;
    return { amount, amountTo, unit, fixed, round };
  }

  /**
   * Process a single instruction string:
   * - Scale all {{}} amounts by the given ratio
   * - Optionally convert units to target system
   * Returns HTML string with measurements wrapped in <span class="measurement">
   */
  function processInstruction(text, ratio, unitSystem, translateUnit) {
    return text.replace(MEASUREMENT_RE, (match, token) => {
      const parsed = parseToken(token);
      if (!parsed) return match;

      const display = Converter.formatMeasurement(parsed, ratio, unitSystem, translateUnit);

      // Data attributes carry the ORIGINAL (unscaled, unconverted) values so
      // the static-site runtime can re-render the span for any servings count
      // or unit system without re-parsing the instruction text.
      const attrs =
        ` data-amount="${parsed.amount}"` +
        (parsed.amountTo != null ? ` data-amount-to="${parsed.amountTo}"` : "") +
        (parsed.unit ? ` data-unit="${parsed.unit}"` : "") +
        (parsed.fixed ? ` data-fixed="1"` : "") +
        (parsed.round ? ` data-round="${parsed.round}"` : "");

      return `<span class="measurement"${attrs}>${display}</span>`;
    });
  }

  /**
   * Process instructions in any of the three supported formats.
   * @param {Function} translateUnit - optional fn(unit) -> translated unit string
   * Returns an array of { section, steps } objects (normalized).
   */
  function processInstructions(instructions, ratio, unitSystem, translateUnit) {
    if (typeof instructions === "string") {
      return [{ section: null, steps: [processInstruction(instructions, ratio, unitSystem, translateUnit)] }];
    }

    if (Array.isArray(instructions)) {
      if (instructions.length === 0) return [];

      if (typeof instructions[0] === "string") {
        return [{
          section: null,
          steps: instructions.map(s => processInstruction(s, ratio, unitSystem, translateUnit)),
        }];
      }

      return instructions.map(sec => ({
        section: sec.section || null,
        steps: (sec.steps || []).map(s => processInstruction(s, ratio, unitSystem, translateUnit)),
      }));
    }

    return [];
  }

  return { processInstruction, processInstructions, parseToken, MEASUREMENT_RE };
})();
