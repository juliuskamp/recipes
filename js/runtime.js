/**
 * Client runtime for the generated static pages (see build.js).
 *
 * Pages arrive fully rendered at default servings / metric / page language.
 * This module hydrates them: it re-renders measurement spans for other
 * servings counts and unit systems (using the same Converter/Scaler modules
 * the build used), and wires up the header controls, cooking mode, and the
 * search page. Loaded with `defer`, so the DOM is ready when it runs.
 */
(() => {
  const PAGE = window.__PAGE__ || {};
  const UNITS = PAGE.units || {};

  // --- Settings (same localStorage keys as the old SPA) ---

  let unitSystem = localStorage.getItem("recipe-units");
  if (unitSystem !== "metric" && unitSystem !== "imperial") unitSystem = "metric";

  let cookingMode = false;
  let currentServings = PAGE.defaultServings || 0;

  // Mirrors App.t("units", ...): active language first, fall back to the key
  // (the "en" section has no units table — English unit keys display as-is).
  function translateUnit(unit) {
    return UNITS[unit] || unit;
  }

  // --- Measurement re-rendering ---
  // Same pipeline as the build: scale (unless fixed/temperature) → convert →
  // apply round step → format → translate unit.

  function renderMeasurement(el, ratio) {
    let amount = parseFloat(el.dataset.amount);
    let unit = el.dataset.unit || null;
    const fixed = el.dataset.fixed === "1";
    const round = el.dataset.round ? parseFloat(el.dataset.round) : null;

    const isTemp = unit && Converter.isTemperature(unit);
    if (!fixed && !isTemp) amount = Scaler.scaleAmount(amount, ratio);

    if (unit && unitSystem) {
      const converted = Converter.convert(amount, unit, unitSystem);
      if (converted) {
        amount = converted.amount;
        unit = converted.unit;
      }
    }

    if (round) amount = Math.round(amount / round) * round;

    const formatted = Converter.formatAmount(amount);
    el.textContent = unit ? `${formatted} ${translateUnit(unit)}` : formatted;
  }

  function renderIngredientAmount(el, ratio) {
    let amount = Scaler.scaleAmount(parseFloat(el.dataset.amount), ratio);
    let unit = el.dataset.unit || null;

    if (unitSystem && unit) {
      const converted = Converter.convert(amount, unit, unitSystem);
      if (converted) {
        amount = converted.amount;
        unit = converted.unit;
      }
    }

    const amountStr = Converter.formatAmount(amount);
    const displayUnit = unit && unit !== "whole" ? ` ${translateUnit(unit)}` : "";
    el.textContent = `${amountStr}${displayUnit}`;
  }

  function renderAllIn(root, ratio) {
    root.querySelectorAll(".measurement[data-amount]").forEach((el) => renderMeasurement(el, ratio));
    root.querySelectorAll(".ingredient-amount[data-amount]").forEach((el) => renderIngredientAmount(el, ratio));
  }

  function currentRatio() {
    if (!PAGE.defaultServings || !currentServings) return 1;
    return Scaler.getRatio(PAGE.defaultServings, currentServings);
  }

  // --- Header controls ---

  function setActive(idOn, idOff) {
    const on = document.getElementById(idOn);
    const off = document.getElementById(idOff);
    if (on) on.classList.add("active");
    if (off) off.classList.remove("active");
  }

  function initTheme() {
    const apply = (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
      setActive(theme === "light" ? "theme-light" : "theme-dark", theme === "light" ? "theme-dark" : "theme-light");
    };
    apply(document.documentElement.getAttribute("data-theme") || "light");
    document.getElementById("theme-light").addEventListener("click", () => {
      localStorage.setItem("recipe-theme", "light");
      apply("light");
    });
    document.getElementById("theme-dark").addEventListener("click", () => {
      localStorage.setItem("recipe-theme", "dark");
      apply("dark");
    });
  }

  function initUnits() {
    const apply = () => {
      setActive(
        unitSystem === "metric" ? "unit-metric" : "unit-imperial",
        unitSystem === "metric" ? "unit-imperial" : "unit-metric"
      );
      renderAllIn(document, currentRatio());
    };
    if (unitSystem !== "metric") apply(); // page is baked metric

    document.getElementById("unit-metric").addEventListener("click", () => {
      unitSystem = "metric";
      localStorage.setItem("recipe-units", unitSystem);
      apply();
    });
    document.getElementById("unit-imperial").addEventListener("click", () => {
      unitSystem = "imperial";
      localStorage.setItem("recipe-units", unitSystem);
      apply();
    });
  }

  function initLangLinks() {
    for (const lang of ["en", "de"]) {
      const el = document.getElementById("lang-" + lang);
      if (!el || el.tagName !== "A") continue;
      el.addEventListener("click", () => {
        localStorage.setItem("recipe-lang", lang);
        // On the search page, carry the active query over to the other language
        if (PAGE.page === "search" && window.location.search) {
          el.href = el.getAttribute("href").split("?")[0] + window.location.search;
        }
      });
    }
  }

  function initSearchInput() {
    const input = document.getElementById("search-input");
    if (!input) return;
    if (PAGE.page === "index") {
      input.addEventListener("focus", () => {
        window.location.href = PAGE.searchPath;
      });
    } else if (PAGE.page === "recipe") {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const q = input.value.trim().toLowerCase();
          window.location.href = PAGE.searchPath + (q ? "?q=" + encodeURIComponent(q) : "");
        }
      });
    }
  }

  /** Hide the divider when the meal-type and tag groups wrap onto separate lines. */
  function updateFilterDivider() {
    const filterBarEl = document.getElementById("filter-bar");
    if (!filterBarEl) return;
    const divider = filterBarEl.querySelector(".filter-divider");
    const meals = document.getElementById("meal-type-filters");
    const tags = document.getElementById("tag-filters");
    if (!divider || !meals || !tags) return;
    requestAnimationFrame(() => {
      const sameLine = meals.offsetTop === tags.offsetTop;
      divider.classList.toggle("hidden", !sameLine);
    });
  }

  // --- Cooking mode (recipe page) ---

  function initCookMode() {
    const btn = document.getElementById("cook-toggle");
    const view = document.getElementById("recipe-view");
    if (!btn || !view) return;

    btn.addEventListener("click", () => {
      cookingMode = !cookingMode;
      btn.classList.toggle("active", cookingMode);

      view.querySelectorAll(".ingredient-list li, .step-list li").forEach((li) => {
        if (cookingMode) {
          li.classList.add("cookable");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "cook-check";
          li.prepend(cb);
        } else {
          li.classList.remove("cookable", "checked");
          const cb = li.querySelector(".cook-check");
          if (cb) cb.remove();
        }
      });
      view.querySelectorAll(".section-title.checked").forEach((el) => el.classList.remove("checked"));
    });

    // Delegated: clicking a cookable item (or its checkbox) toggles it
    view.addEventListener("click", (e) => {
      if (!cookingMode) return;
      const item = e.target.closest(".cookable");
      if (!item) return;
      const cb = item.querySelector(".cook-check");
      if (!cb) return;
      if (e.target !== cb) cb.checked = !cb.checked;
      item.classList.toggle("checked", cb.checked);

      const section = item.closest(".instruction-section");
      if (section) {
        const allChecks = [...section.querySelectorAll(".step-list .cook-check")];
        const allDone = allChecks.every((c) => c.checked);
        section.querySelector(".section-title").classList.toggle("checked", allDone);
      }
    });
  }

  // --- Recipe page ---

  function initRecipePage() {
    const servingsInput = document.getElementById("servings-input");
    if (servingsInput) {
      servingsInput.addEventListener("input", () => {
        const val = parseInt(servingsInput.value, 10);
        if (val > 0) {
          currentServings = val;
          renderAllIn(document.getElementById("recipe-view"), currentRatio());
          const printNum = document.querySelector(".servings-print-num");
          if (printNum) printNum.textContent = val;
        }
      });
    }

    const downloadBtn = document.getElementById("download-pdf");
    if (downloadBtn) downloadBtn.addEventListener("click", () => window.print());

    initCookMode();
  }

  // --- Index page: combined "download all" PDF via the print engine ---

  function initIndexPage() {
    const btn = document.getElementById("download-all");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      let html;
      try {
        const res = await fetch(PAGE.printFragment);
        html = await res.text();
      } catch (e) {
        console.error("Could not load print fragment:", e);
        return;
      }
      const container = document.createElement("div");
      container.id = "print-all";
      container.innerHTML = html;
      if (unitSystem !== "metric") renderAllIn(container, 1);
      document.body.appendChild(container);
      document.body.classList.add("printing-all");

      const cleanup = () => {
        container.remove();
        document.body.classList.remove("printing-all");
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      window.print();
      // Fallback in case afterprint never fires (container is hidden on screen anyway).
      setTimeout(cleanup, 1000);
    });
  }

  // --- Search page ---

  function foldText(s) {
    return s
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function initSearchPage() {
    const view = document.getElementById("search-view");
    const input = document.getElementById("search-input");
    const entries = PAGE.entries || [];

    const params = new URLSearchParams(window.location.search);
    let query = (params.get("q") || "").trim().toLowerCase();
    let activeMealType = params.get("meal") || null;
    let activeTags = new Set((params.get("tags") || "").split(",").filter(Boolean));
    input.value = query;

    function buildUrl() {
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      if (activeMealType) p.set("meal", activeMealType);
      if (activeTags.size > 0) p.set("tags", [...activeTags].join(","));
      const qs = p.toString();
      return window.location.pathname + (qs ? "?" + qs : "");
    }

    function matches(entry) {
      if (query) {
        if (!foldText(entry.title).includes(foldText(query))) return false;
      }
      if (activeMealType && entry.mealType !== activeMealType) return false;
      for (const tag of activeTags) {
        if (!entry.tags.includes(tag)) return false;
      }
      return true;
    }

    function render() {
      const filtered = entries.filter(matches);
      view.innerHTML =
        filtered.length === 0
          ? `<p>${PAGE.noRecipes}</p>`
          : `<div class="recipe-list">${filtered.map((e) => e.html).join("")}</div>`;
    }

    function updateChips() {
      document.querySelectorAll("#meal-type-filters .filter-btn").forEach((el) => {
        el.classList.toggle("active", el.dataset.meal === activeMealType);
      });
      document.querySelectorAll("#tag-filters .filter-btn").forEach((el) => {
        el.classList.toggle("active", activeTags.has(el.dataset.tag));
      });
      updateFilterDivider();
    }

    input.addEventListener("input", () => {
      query = input.value.trim().toLowerCase();
      history.replaceState(null, "", buildUrl());
      render();
    });

    document.querySelectorAll("#meal-type-filters .filter-btn").forEach((el) => {
      el.addEventListener("click", () => {
        activeMealType = activeMealType === el.dataset.meal ? null : el.dataset.meal;
        history.replaceState(null, "", buildUrl());
        updateChips();
        render();
      });
    });

    document.querySelectorAll("#tag-filters .filter-btn").forEach((el) => {
      el.addEventListener("click", () => {
        if (activeTags.has(el.dataset.tag)) activeTags.delete(el.dataset.tag);
        else activeTags.add(el.dataset.tag);
        history.replaceState(null, "", buildUrl());
        updateChips();
        render();
      });
    });

    updateChips();
    render();
    if (!window.location.search) input.focus();
  }

  // --- Init ---

  initTheme();
  initUnits();
  initLangLinks();
  initSearchInput();
  updateFilterDivider();
  window.addEventListener("resize", updateFilterDivider);

  if (PAGE.page === "recipe") initRecipePage();
  else if (PAGE.page === "index") initIndexPage();
  else if (PAGE.page === "search") initSearchPage();
})();
