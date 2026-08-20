import pytest

from mapping import (
    MappingError,
    assign_tokens,
    build_mapping,
    format_token,
    mapping_from_json,
    mapping_to_json,
    new_mapping,
    new_seed,
    token_for,
    update_entity,
)


def test_format_token():
    assert format_token("CUST", 7, 4) == "CUST-0007"
    assert format_token("PROD", 142, 4) == "PROD-0142"


def test_new_seed_is_random_and_nonempty():
    a, b = new_seed(), new_seed()
    assert a != b
    assert len(a) > 0


def test_assign_tokens_fresh():
    values = assign_tokens({}, ["a", "b", "c"], seed="fixed")
    assert set(values.keys()) == {"a", "b", "c"}
    assert set(values.values()) == {1, 2, 3}  # numbers 1..N, no gaps


def test_assign_tokens_same_seed_same_result():
    v1 = assign_tokens({}, ["a", "b", "c"], seed="fixed")
    v2 = assign_tokens({}, ["a", "b", "c"], seed="fixed")
    assert v1 == v2


def test_assign_tokens_different_seed_different_order_usually():
    v1 = assign_tokens({}, [f"v{i}" for i in range(30)], seed="seed-one")
    v2 = assign_tokens({}, [f"v{i}" for i in range(30)], seed="seed-two")
    assert v1 != v2  # with 30 values an identical permutation is practically impossible


def test_assign_tokens_not_sequential_by_appearance():
    # with a fixed seed the numbering does not follow list order --
    # design.md §3: "shuffled order, not order of appearance"
    values = assign_tokens({}, [f"v{i}" for i in range(20)], seed="fixed")
    appearance_order_numbers = [values[f"v{i}"] for i in range(20)]
    assert appearance_order_numbers != list(range(1, 21))


def test_assign_tokens_result_independent_of_input_order():
    # same set of values in a different list order -> same result (sorted
    # before shuffling, so it does not depend on row order in the file)
    v1 = assign_tokens({}, ["b", "a", "c"], seed="fixed")
    v2 = assign_tokens({}, ["c", "b", "a"], seed="fixed")
    assert v1 == v2


def test_assign_tokens_incremental_keeps_existing_numbers():
    existing = assign_tokens({}, ["a", "b"], seed="fixed")
    extended = assign_tokens(existing, ["a", "b", "c"], seed="fixed")
    assert extended["a"] == existing["a"]
    assert extended["b"] == existing["b"]
    assert "c" in extended
    assert extended["c"] not in {existing["a"], existing["b"]}


def test_assign_tokens_no_new_values_returns_unchanged():
    existing = assign_tokens({}, ["a", "b"], seed="fixed")
    result = assign_tokens(existing, ["a", "b"], seed="fixed")
    assert result == existing


def test_update_entity_and_token_for():
    mapping = new_mapping()
    update_entity(mapping, "customer", "CUST", 4, ["Globex LLC", "Acme Inc"])
    token = token_for(mapping, "customer", "Globex LLC")
    assert token is not None
    assert token.startswith("CUST-")
    assert len(token) == len("CUST-0000")


def test_token_for_unknown_value_returns_none():
    mapping = new_mapping()
    update_entity(mapping, "customer", "CUST", 4, ["a"])
    assert token_for(mapping, "customer", "unknown") is None
    assert token_for(mapping, "unknown_entity", "a") is None


def test_update_entity_same_value_same_token_across_calls():
    # invariant 1 (requirements.md §3): one value -> one token everywhere
    mapping = new_mapping()
    update_entity(mapping, "customer", "CUST", 4, ["Globex LLC"])
    t1 = token_for(mapping, "customer", "Globex LLC")
    update_entity(mapping, "customer", "CUST", 4, ["Globex LLC", "Acme Inc"])
    t2 = token_for(mapping, "customer", "Globex LLC")
    assert t1 == t2


def test_build_mapping_merges_columns_across_files_into_one_entity():
    config = {
        "entities": {
            "customer": {
                "prefix": "CUST",
                "width": 4,
                "columns": [
                    {"file_pattern": "orders.xlsx", "sheet_name": "Orders", "column_name": "counterparty"},
                    {"file_pattern": "customers.xlsx", "sheet_name": "Customers", "column_name": "name"},
                ],
            }
        }
    }
    values_by_column = {
        "orders.xlsx": {"Orders": {"counterparty": ["Globex LLC", "Acme Inc"]}},
        "customers.xlsx": {"Customers": {"name": ["Globex LLC", "Beta LLC"]}},
    }
    mapping = build_mapping(config, values_by_column)
    values = mapping["entities"]["customer"]["values"]
    # values from both files are merged and "Globex LLC" is not duplicated
    assert set(values.keys()) == {"Globex LLC", "Acme Inc", "Beta LLC"}


def test_build_mapping_with_existing_mapping_preserves_tokens():
    config = {
        "entities": {"customer": {"prefix": "CUST", "width": 4, "columns": [
            {"file_pattern": "orders.xlsx", "sheet_name": "Orders", "column_name": "counterparty"}
        ]}}
    }
    values_by_column = {"orders.xlsx": {"Orders": {"counterparty": ["Globex LLC"]}}}
    first = build_mapping(config, values_by_column)
    old_token = token_for(first, "customer", "Globex LLC")

    values_by_column_2 = {"orders.xlsx": {"Orders": {"counterparty": ["Globex LLC", "Acme Inc"]}}}
    second = build_mapping(config, values_by_column_2, existing_mapping=first)
    new_token = token_for(second, "customer", "Globex LLC")
    assert old_token == new_token  # appending must not change tokens already issued


def test_mapping_json_round_trip():
    mapping = new_mapping()
    update_entity(mapping, "customer", "CUST", 4, ["a", "b"])
    text = mapping_to_json(mapping)
    restored = mapping_from_json(text)
    assert restored["seed"] == mapping["seed"]
    assert restored["entities"]["customer"]["values"] == mapping["entities"]["customer"]["values"]


def test_mapping_from_json_invalid_json():
    with pytest.raises(MappingError, match="JSON"):
        mapping_from_json("{not json")


def test_mapping_from_json_missing_keys_rejected():
    with pytest.raises(MappingError):
        mapping_from_json("{}")
