#!/usr/bin/env node
"use strict";

/**
 * Validate recipe JSON files against schema.json. Node stdlib only.
 * Port of the former validate.py — schema.json stays the single source of
 * truth; only the extra cross-field checks live in code.
 *
 * Usage: node validate.js <recipe.json> [...]
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "schema.json");

function checkType(data, schemaType) {
  switch (schemaType) {
    case "object": return typeof data === "object" && data !== null && !Array.isArray(data);
    case "array": return Array.isArray(data);
    case "string": return typeof data === "string";
    case "number": return typeof data === "number";
    case "integer": return Number.isInteger(data);
    case "boolean": return typeof data === "boolean";
    case "null": return data === null;
    default: return true;
  }
}

/**
 * Validate data against a JSON Schema (subset: type, required, properties,
 * additionalProperties, items, enum, pattern, minimum, minLength, oneOf).
 */
function validateSchema(data, schema, p = "") {
  const errors = [];
  const loc = p || "/";

  if ("type" in schema) {
    if (!checkType(data, schema.type)) {
      errors.push(`${loc}: expected type '${schema.type}', got ${Array.isArray(data) ? "array" : typeof data}`);
      return errors; // no point checking further
    }
  }

  if ("enum" in schema) {
    if (!schema.enum.includes(data)) {
      errors.push(`${loc}: value ${JSON.stringify(data)} not in ${JSON.stringify(schema.enum)}`);
    }
  }

  if ("pattern" in schema && typeof data === "string") {
    if (!new RegExp(schema.pattern).test(data)) {
      errors.push(`${loc}: ${JSON.stringify(data)} does not match pattern ${schema.pattern}`);
    }
  }

  if ("minimum" in schema && typeof data === "number") {
    if (data < schema.minimum) {
      errors.push(`${loc}: ${data} < minimum ${schema.minimum}`);
    }
  }

  if ("minLength" in schema && typeof data === "string") {
    if (data.length < schema.minLength) {
      errors.push(`${loc}: string length ${data.length} < minLength ${schema.minLength}`);
    }
  }

  if ("required" in schema && checkType(data, "object")) {
    for (const field of schema.required) {
      if (!(field in data)) {
        errors.push(`${loc}: missing required field '${field}'`);
      }
    }
  }

  if ("properties" in schema && checkType(data, "object")) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in data) {
        errors.push(...validateSchema(data[key], subSchema, `${p}/${key}`));
      }
    }
  }

  if ("additionalProperties" in schema && checkType(data, "object")) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    const ap = schema.additionalProperties;
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) {
        if (ap === false) {
          errors.push(`${loc}: unexpected property '${key}'`);
        } else if (typeof ap === "object" && ap !== null) {
          errors.push(...validateSchema(data[key], ap, `${p}/${key}`));
        }
      }
    }
  }

  if ("items" in schema && Array.isArray(data)) {
    data.forEach((item, i) => {
      errors.push(...validateSchema(item, schema.items, `${p}[${i}]`));
    });
  }

  if ("oneOf" in schema) {
    let matches = 0;
    for (const option of schema.oneOf) {
      if (validateSchema(data, option, p).length === 0) matches++;
    }
    if (matches === 0) errors.push(`${loc}: does not match any oneOf option`);
    else if (matches > 1) errors.push(`${loc}: matches multiple oneOf options`);
  }

  return errors;
}

/** Cross-field checks that plain JSON Schema can't express. */
function extraChecks(data, schema) {
  const errors = [];
  if (!checkType(data, "object")) return errors;

  // Translation ingredient count must match ingredients count
  if (data.translations && data.ingredients) {
    const n = data.ingredients.length;
    for (const [lang, tr] of Object.entries(data.translations)) {
      if (tr && tr.ingredients && tr.ingredients.length !== n) {
        errors.push(
          `/translations/${lang}/ingredients: has ${tr.ingredients.length} ` +
          `entries but recipe has ${n} ingredients`
        );
      }
    }
  }

  // Variant-specific checks
  if (Array.isArray(data.variants)) {
    const nIngredients = (data.ingredients || []).length;
    const seenVariantNames = new Set();
    const ingredientSchema =
      ((schema.properties || {}).ingredients || {}).items || null;

    data.variants.forEach((variant, i) => {
      if (!checkType(variant, "object")) return;

      const vname = variant.variant_name;
      if (vname !== undefined) {
        if (seenVariantNames.has(vname)) {
          errors.push(`/variants[${i}]/variant_name: duplicate variant_name ${JSON.stringify(vname)}`);
        }
        seenVariantNames.add(vname);
      }

      if (variant.ingredients && checkType(variant.ingredients, "object")) {
        for (const [key, override] of Object.entries(variant.ingredients)) {
          if (!/^-?\d+$/.test(key)) {
            errors.push(`/variants[${i}]/ingredients/${key}: key must be a string integer`);
            continue;
          }
          const idx = parseInt(key, 10);
          if (idx < 0 || idx >= nIngredients) {
            errors.push(
              `/variants[${i}]/ingredients/${key}: index out of range ` +
              `(recipe has ${nIngredients} ingredients)`
            );
          }
          if (ingredientSchema) {
            errors.push(...validateSchema(override, ingredientSchema, `/variants[${i}]/ingredients/${key}`));
          }
        }
      }
    });

    // Translation variant arrays must have same length as base variants
    if (data.translations && checkType(data.translations, "object")) {
      const nVariants = data.variants.length;
      for (const [lang, tr] of Object.entries(data.translations)) {
        if (!tr || !("variants" in tr) || !Array.isArray(tr.variants)) continue;
        if (tr.variants.length !== nVariants) {
          errors.push(
            `/translations/${lang}/variants: has ${tr.variants.length} ` +
            `entries but recipe has ${nVariants} variants`
          );
        }
        tr.variants.forEach((tv, j) => {
          if (!checkType(tv, "object")) return;
          if (tv.ingredients && checkType(tv.ingredients, "object")) {
            for (const key of Object.keys(tv.ingredients)) {
              if (!/^-?\d+$/.test(key)) {
                errors.push(`/translations/${lang}/variants[${j}]/ingredients/${key}: key must be a string integer`);
                continue;
              }
              const idx = parseInt(key, 10);
              if (idx < 0 || idx >= nIngredients) {
                errors.push(
                  `/translations/${lang}/variants[${j}]/ingredients/${key}: ` +
                  `index out of range (recipe has ${nIngredients} ingredients)`
                );
              }
            }
          }
        });
      }
    }
  }

  return errors;
}

/** Validate parsed recipe data. Returns an array of error strings. */
function validateRecipe(data, schema) {
  return [...validateSchema(data, schema), ...extraChecks(data, schema)];
}

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

function validateFile(filePath, schema) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.log(`INVALID JSON in ${filePath}: ${e.message}`);
    return false;
  }

  const errors = validateRecipe(data, schema);
  if (errors.length > 0) {
    console.log(`ERRORS in ${filePath}:`);
    for (const e of errors) console.log(`  - ${e}`);
    return false;
  }
  return true;
}

module.exports = { validateSchema, validateRecipe, loadSchema, validateFile };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: validate.js <recipe.json> [...]");
    process.exit(1);
  }

  const schema = loadSchema();
  let ok = true;
  for (const p of args) {
    if (!validateFile(p, schema)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}
