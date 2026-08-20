import json
import random
import secrets


class MappingError(ValueError):
    pass


def new_seed():
    return secrets.token_hex(8)


def format_token(prefix, number, width):
    return f"{prefix}-{number:0{width}d}"


def assign_tokens(existing_values, new_values, seed):
    """existing_values: {value: number}, tokens already assigned for this
    entity. new_values: values not in there yet (this function filters out
    anything already present anyway). Returns the FULL value -> number
    dictionary (existing + new).

    Determinism: `to_assign` is sorted before shuffling, so the result
    depends only on the set of new values and on `seed`, never on the row
    order in the file (design.md §3: "a run stays repeatable"). Numbers are
    handed out in shuffled order rather than order of appearance --
    design.md §3: otherwise the token number itself leaks information
    (who came first, who is biggest).
    """
    values = dict(existing_values or {})
    used_numbers = set(values.values())
    to_assign = sorted({v for v in new_values if v not in values})
    if not to_assign:
        return values

    rng = random.Random(seed)
    candidates = []
    n = 1
    while len(candidates) < len(to_assign):
        if n not in used_numbers:
            candidates.append(n)
        n += 1
    rng.shuffle(candidates)

    for value, number in zip(to_assign, candidates):
        values[value] = number
    return values


def new_mapping():
    return {"version": 1, "seed": new_seed(), "entities": {}}


def update_entity(mapping, entity_name, prefix, width, new_values):
    """Add new values to an entity, creating it if it does not exist yet.
    Mutates and returns `mapping` so calls can be chained."""
    entity = mapping["entities"].setdefault(
        entity_name, {"prefix": prefix, "width": width, "values": {}}
    )
    entity["prefix"] = prefix
    entity["width"] = width
    entity["values"] = assign_tokens(entity["values"], new_values, mapping["seed"])
    return mapping


def token_for(mapping, entity_name, value):
    entity = mapping["entities"].get(entity_name)
    if not entity or value not in entity["values"]:
        return None
    return format_token(entity["prefix"], entity["values"][value], entity["width"])


def build_mapping(config, values_by_column, existing_mapping=None):
    """config: an AnonConfig dict (`config.py`) -- entities: {name:
    {prefix, width, columns: [{file_pattern, sheet_name, column_name}]}}.
    values_by_column: {file: {sheet: {column: [values...]}}} -- from the
    streaming projection (`engine.extract_unique_values`), collected for
    every file the config refers to.
    existing_mapping: a dictionary to append to (design.md §4), or None to
    create a fresh one with a new seed.

    One entity can span columns from several files/sheets (§5) -- their
    values are merged into a single set before tokens are handed out, and
    that is exactly where cross-file referential integrity comes from.
    """
    mapping = existing_mapping or new_mapping()
    for entity_name, entity_cfg in config["entities"].items():
        all_values = set()
        for col in entity_cfg["columns"]:
            file_values = values_by_column.get(col["file_pattern"], {})
            sheet_values = file_values.get(col["sheet_name"], {})
            all_values.update(sheet_values.get(col["column_name"], []))
        update_entity(mapping, entity_name, entity_cfg["prefix"], entity_cfg["width"], all_values)
    return mapping


def mapping_from_json(text):
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise MappingError(f"invalid JSON: {e}")
    if "entities" not in data or "seed" not in data:
        raise MappingError("dictionary has no 'entities' or 'seed' key -- does not look like mapping.json")
    return data


def mapping_to_json(mapping):
    return json.dumps(mapping, ensure_ascii=False, indent=2)
