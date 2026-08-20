import json
import re
from dataclasses import asdict, dataclass, field
from typing import Optional


class ConfigError(ValueError):
    pass


@dataclass
class ColumnSelector:
    file_pattern: str
    column_name: str
    sheet_name: Optional[str] = None
    extract_regex: Optional[str] = None

    def __post_init__(self):
        if not self.file_pattern:
            raise ConfigError("file_pattern must not be empty")
        if not self.column_name:
            raise ConfigError("column_name must not be empty")
        if self.extract_regex is not None:
            try:
                compiled = re.compile(self.extract_regex)
            except re.error as e:
                raise ConfigError(f"extract_regex is invalid: {e}")
            if compiled.groups != 1:
                raise ConfigError(
                    "extract_regex must contain exactly one capturing "
                    f"group, found {compiled.groups}"
                )


@dataclass
class EntityConfig:
    prefix: str
    width: int = 6
    columns: list = field(default_factory=list)

    def __post_init__(self):
        if not (2 <= len(self.prefix) <= 10):
            raise ConfigError(f"prefix '{self.prefix}' must be 2-10 characters long")
        if not (4 <= self.width <= 12):
            raise ConfigError(f"width must be 4-12, got {self.width}")
        self.columns = [
            c if isinstance(c, ColumnSelector) else ColumnSelector(**c)
            for c in self.columns
        ]


@dataclass
class AnonConfig:
    entities: dict
    version: int = 1

    def __post_init__(self):
        self.entities = {
            name: (e if isinstance(e, EntityConfig) else EntityConfig(**e))
            for name, e in self.entities.items()
        }
        prefixes = [e.prefix for e in self.entities.values()]
        if len(prefixes) != len(set(prefixes)):
            dupes = {p for p in prefixes if prefixes.count(p) > 1}
            raise ConfigError(f"entity prefixes are not unique: {sorted(dupes)}")

    def to_dict(self):
        return {
            "version": self.version,
            "entities": {name: asdict(e) for name, e in self.entities.items()},
        }

    @classmethod
    def from_dict(cls, data):
        if "entities" not in data:
            raise ConfigError("config has no 'entities' key")
        return cls(version=data.get("version", 1), entities=data["entities"])


def config_from_json(text: str) -> AnonConfig:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ConfigError(f"invalid JSON: {e}")
    return AnonConfig.from_dict(data)


def config_to_json(config: AnonConfig) -> str:
    return json.dumps(config.to_dict(), ensure_ascii=False, indent=2)


def columns_for_file(config: dict, file_pattern: str) -> dict:
    """config is a plain dict (not necessarily validated through
    AnonConfig -- it may be a "raw" JSON dict of the same shape).
    Returns {sheet_name: {column_name: {"entity": ..., "extract_regex": ...}}}
    for the columns whose `file_pattern` matches `file_pattern`. Shared by
    the streaming projection (`engine.py`) and by masking (`masker.py`) so
    the grouping logic is not duplicated."""
    result: dict = {}
    for entity_name, entity in config["entities"].items():
        for col in entity["columns"]:
            if col["file_pattern"] != file_pattern:
                continue
            sheet = col.get("sheet_name")
            per_sheet = result.setdefault(sheet, {})
            per_sheet[col["column_name"]] = {
                "entity": entity_name,
                "extract_regex": col.get("extract_regex"),
            }
    return result
