import pytest

from config import AnonConfig, ColumnSelector, ConfigError, config_from_json, config_to_json


def test_valid_config_accepted():
    cfg = AnonConfig(
        entities={
            "customer": {
                "prefix": "CUST",
                "width": 4,
                "columns": [{"file_pattern": "orders.xlsx", "column_name": "buyer"}],
            }
        }
    )
    assert cfg.version == 1
    assert cfg.entities["customer"].prefix == "CUST"
    assert isinstance(cfg.entities["customer"].columns[0], ColumnSelector)


def test_defaults():
    cfg = AnonConfig(entities={"a": {"prefix": "AB"}})
    assert cfg.entities["a"].width == 6
    assert cfg.entities["a"].columns == []


@pytest.mark.parametrize("prefix", ["A", "", "TOOLONGPREFIX"])
def test_prefix_length_rejected(prefix):
    with pytest.raises(ConfigError):
        AnonConfig(entities={"a": {"prefix": prefix}})


@pytest.mark.parametrize("width", [3, 13, 0])
def test_width_range_rejected(width):
    with pytest.raises(ConfigError):
        AnonConfig(entities={"a": {"prefix": "AB", "width": width}})


def test_duplicate_prefixes_rejected():
    with pytest.raises(ConfigError, match="XX"):
        AnonConfig(entities={"a": {"prefix": "XX"}, "b": {"prefix": "XX"}})


def test_extract_regex_valid_single_group():
    col = ColumnSelector(
        file_pattern="orders.xlsx", column_name="sku", extract_regex="SKU-(.*?)-[A-Z]"
    )
    assert col.extract_regex == "SKU-(.*?)-[A-Z]"


def test_extract_regex_two_groups_rejected():
    with pytest.raises(ConfigError, match="exactly one capturing"):
        ColumnSelector(file_pattern="f.xlsx", column_name="c", extract_regex="(a)(b)")


def test_extract_regex_zero_groups_rejected():
    with pytest.raises(ConfigError, match="exactly one capturing"):
        ColumnSelector(file_pattern="f.xlsx", column_name="c", extract_regex="abc")


def test_extract_regex_invalid_syntax_rejected():
    with pytest.raises(ConfigError, match="is invalid"):
        ColumnSelector(file_pattern="f.xlsx", column_name="c", extract_regex="(unclosed")


def test_empty_file_pattern_rejected():
    with pytest.raises(ConfigError):
        ColumnSelector(file_pattern="", column_name="c")


def test_json_round_trip():
    original = AnonConfig(
        entities={
            "customer": {"prefix": "CUST", "width": 4},
            "product": {
                "prefix": "PROD",
                "columns": [
                    {
                        "file_pattern": "orders.xlsx",
                        "sheet_name": "Orders",
                        "column_name": "sku",
                        "extract_regex": "SKU-(.*?)-[A-Z]",
                    }
                ],
            },
        }
    )
    text = config_to_json(original)
    restored = config_from_json(text)
    assert restored.entities.keys() == original.entities.keys()
    assert restored.entities["product"].columns[0].extract_regex == "SKU-(.*?)-[A-Z]"


def test_invalid_json_rejected():
    with pytest.raises(ConfigError, match="JSON"):
        config_from_json("{not valid json")


def test_missing_entities_key_rejected():
    with pytest.raises(ConfigError, match="entities"):
        config_from_json("{}")
