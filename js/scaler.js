/**
 * Scales recipe amounts based on desired servings.
 */
const Scaler = (() => {
  /**
   * Get the scaling ratio for a recipe.
   */
  function getRatio(defaultServings, currentServings) {
    if (defaultServings <= 0 || currentServings <= 0) return 1;
    return currentServings / defaultServings;
  }

  /**
   * Scale a single amount by the ratio.
   */
  function scaleAmount(amount, ratio) {
    return amount * ratio;
  }

  /**
   * Scale all ingredients in a recipe and return new ingredient objects.
   */
  function scaleIngredients(ingredients, ratio) {
    return ingredients.map(ing => ({
      ...ing,
      amount: ing.amount != null ? scaleAmount(ing.amount, ratio) : null,
    }));
  }

  return { getRatio, scaleAmount, scaleIngredients };
})();
