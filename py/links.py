OVERLAP_THRESHOLD = 0.95


def _same_column(a, b):
    return a["file"] == b["file"] and a["sheet"] == b["sheet"] and a["column"] == b["column"]


def _containment(set_a, set_b):
    """Share of set_a's values that also occur in set_b. design.md §8:
    "if 95% of column A's distinct values occur in column B"."""
    if not set_a:
        return 0.0
    return len(set_a & set_b) / len(set_a)


def propose_links(columns):
    """columns: [{file, sheet, column, entity, values}, ...] -- the columns
    ticked for masking (§4), with their distinct values taken from the
    streaming projection (`engine.extract_unique_values`).

    Two ways to propose a link (design.md §8); both are returned together
    and a column pair can match on both at once:
    1. The same entity was assigned on the column-mapping screen.
    2. Value-set overlap >= 95% in either direction -- more reliable than
       matching names, especially when columns are named differently or
       sloppily.
    """
    links = []
    for i in range(len(columns)):
        for j in range(i + 1, len(columns)):
            a, b = columns[i], columns[j]
            if _same_column(a, b):
                continue
            reasons = []
            if a.get("entity") and a["entity"] == b.get("entity"):
                reasons.append(f"same entity \"{a['entity']}\"")

            set_a, set_b = set(a.get("values") or []), set(b.get("values") or [])
            if set_a and set_b:
                best = max(_containment(set_a, set_b), _containment(set_b, set_a))
                if best >= OVERLAP_THRESHOLD:
                    reasons.append(f"{round(best * 100)}% value overlap")

            if reasons:
                links.append(
                    {
                        "a": {"file": a["file"], "sheet": a["sheet"], "column": a["column"]},
                        "b": {"file": b["file"], "sheet": b["sheet"], "column": b["column"]},
                        "reason": "; ".join(reasons),
                    }
                )
    return links
