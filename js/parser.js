/**
 * Parses recipe instructions and handles the {{amount unit}} template syntax.
 */
const Parser = (() => {
  // Matches {{amount unit}} or {{amount}}
  const MEASUREMENT_RE = /\{\{([^}]+)\}\}/g;

  /**
   * Parse a single {{...}} token into { amount, unit } or { amount }.
   * Examples:
   *   "2 cups"  -> { amount: 2, unit: "cups" }
   *   "0.5 tsp" -> { amount: 0.5, unit: "tsp" }
   *   "4"       -> { amount: 4, unit: null }
   */
  function parseToken(token) {
    const trimmed = token.trim();
    const parts = trimmed.split(/\s+/);

    const amount = parseFloat(parts[0]);
    if (isNaN(amount)) return null;

    const unit = parts.length > 1 ? parts.slice(1).join(" ") : null;
    return { amount, unit };
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

      let { amount, unit } = parsed;

      // Scale
      amount = Scaler.scaleAmount(amount, ratio);

      // Convert units if requested
      if (unit && unitSystem) {
        const converted = Converter.convert(amount, unit, unitSystem);
        if (converted) {
          amount = converted.amount;
          unit = converted.unit;
        }
      }

      const formatted = Converter.formatAmount(amount);
      const displayUnit = unit && translateUnit ? translateUnit(unit) : unit;
      const display = displayUnit ? `${formatted} ${displayUnit}` : formatted;

      return `<span class="measurement">${display}</span>`;
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
