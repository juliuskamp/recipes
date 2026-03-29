#!/usr/bin/env python3
"""Validate recipe JSON files against schema.json. Uses only Python stdlib."""

import json
import re
import sys
import os

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.json")


def validate_schema(data, schema, path=""):
    """Validate data against a JSON Schema (subset: type, required, properties,
    additionalProperties, items, enum, pattern, minimum, minLength, oneOf)."""
    errors = []

    # type
    if "type" in schema:
        if not check_type(data, schema["type"]):
            errors.append(f"{path or '/'}: expected type '{schema['type']}', got {type(data).__name__}")
            return errors  # no point checking further

    # enum
    if "enum" in schema:
        if data not in schema["enum"]:
            errors.append(f"{path or '/'}: value {data!r} not in {schema['enum']}")

    # pattern
    if "pattern" in schema and isinstance(data, str):
        if not re.match(schema["pattern"], data):
            errors.append(f"{path or '/'}: {data!r} does not match pattern {schema['pattern']}")

    # minimum
    if "minimum" in schema and isinstance(data, (int, float)):
        if data < schema["minimum"]:
            errors.append(f"{path or '/'}: {data} < minimum {schema['minimum']}")

    # minLength
    if "minLength" in schema and isinstance(data, str):
        if len(data) < schema["minLength"]:
            errors.append(f"{path or '/'}: string length {len(data)} < minLength {schema['minLength']}")

    # required
    if "required" in schema and isinstance(data, dict):
        for field in schema["required"]:
            if field not in data:
                errors.append(f"{path or '/'}: missing required field '{field}'")

    # properties
    if "properties" in schema and isinstance(data, dict):
        for key, sub_schema in schema["properties"].items():
            if key in data:
                errors.extend(validate_schema(data[key], sub_schema, f"{path}/{key}"))

    # additionalProperties
    if "additionalProperties" in schema and isinstance(data, dict):
        allowed = set(schema.get("properties", {}).keys())
        ap = schema["additionalProperties"]
        for key in data:
            if key not in allowed:
                if ap is False:
                    errors.append(f"{path or '/'}: unexpected property '{key}'")
                elif isinstance(ap, dict):
                    errors.extend(validate_schema(data[key], ap, f"{path}/{key}"))

    # items
    if "items" in schema and isinstance(data, list):
        for i, item in enumerate(data):
            errors.extend(validate_schema(item, schema["items"], f"{path}[{i}]"))

    # oneOf
    if "oneOf" in schema:
        matches = 0
        for option in schema["oneOf"]:
            if not validate_schema(data, option, path):
                matches += 1
        if matches == 0:
            errors.append(f"{path or '/'}: does not match any oneOf option")
        elif matches > 1:
            errors.append(f"{path or '/'}: matches multiple oneOf options")

    return errors


def check_type(data, schema_type):
    if schema_type == "object":
        return isinstance(data, dict)
    if schema_type == "array":
        return isinstance(data, list)
    if schema_type == "string":
        return isinstance(data, str)
    if schema_type == "number":
        return isinstance(data, (int, float)) and not isinstance(data, bool)
    if schema_type == "integer":
        return isinstance(data, int) and not isinstance(data, bool)
    if schema_type == "boolean":
        return isinstance(data, bool)
    if schema_type == "null":
        return data is None
    return True


def validate(path, schema):
    try:
        with open(path) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"INVALID JSON in {path}: {e}")
        return False

    errors = validate_schema(data, schema)

    # Extra check: recipe id must match filename (without .json)
    if isinstance(data, dict) and "id" in data:
        filename = os.path.splitext(os.path.basename(path))[0]
        if data["id"] != filename:
            errors.append(f"/id: value '{data['id']}' does not match filename '{filename}.json'")

    # Extra check: translation ingredient count must match ingredients count
    if isinstance(data, dict) and "translations" in data and "ingredients" in data:
        n = len(data["ingredients"])
        for lang, tr in data["translations"].items():
            if "ingredients" in tr and len(tr["ingredients"]) != n:
                errors.append(
                    f"/translations/{lang}/ingredients: has {len(tr['ingredients'])} "
                    f"entries but recipe has {n} ingredients"
                )

    if errors:
        print(f"ERRORS in {path}:")
        for e in errors:
            print(f"  - {e}")
        return False

    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: validate.py <recipe.json> [...]")
        sys.exit(1)

    with open(SCHEMA_PATH) as f:
        schema = json.load(f)

    ok = True
    for path in sys.argv[1:]:
        if not validate(path, schema):
            ok = False

    sys.exit(0 if ok else 1)
