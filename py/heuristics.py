import re
from datetime import date, datetime

# No column-heading analysis, by owner's decision 2026-08-20 (design.md §7).
# Headings can be named anything, and we can never know from the outside what
# a given column actually holds -- naming the entity is the client's job
# (requirements.md §6). A pre-filled wrong guess is worse than an empty
# field, because it invites being accepted without a check. What is left is
# the value-shape default rule, which decides only whether to propose masking
# at all, never what the column means.

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[\d\s()+\-]{7,20}$")


def _is_numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_date(value):
    return isinstance(value, (date, datetime))


def guess_shape(sample_values):
    """Classify a column's values as numeric/date/email/phone/text/empty."""
    non_empty = [v for v in sample_values if v is not None and v != ""]
    if not non_empty:
        return "empty"
    if all(_is_date(v) for v in non_empty):
        return "date"
    if all(_is_numeric(v) for v in non_empty):
        return "numeric"
    str_values = [str(v) for v in non_empty]
    if all(EMAIL_RE.match(v) for v in str_values):
        return "email"
    if all(PHONE_RE.match(v) for v in str_values):
        return "phone"
    return "text"


def guess_column(sample_values):
    """Guess for a single column -- level 0 (design.md §7), from the values
    alone; the heading is deliberately not examined.

    Default rule: numeric and date columns are left alone (`touch=False`);
    text columns are proposed for masking (`touch=True`). Silent skipping is
    forbidden -- the result always carries a `reason`.

    `entity` is only ever filled in when the values themselves say what they
    are (email addresses, phone numbers). Otherwise it stays None and the
    client names the entity, which is what requirements.md §6 asks of them.
    """
    shape = guess_shape(sample_values)
    if shape in ("numeric", "date", "empty"):
        return {
            "entity": None,
            "shape": shape,
            "touch": False,
            "reason": f"{shape} column -- left alone",
        }
    if shape == "email":
        return {
            "entity": "email",
            "shape": shape,
            "touch": True,
            "reason": "values look like email addresses",
        }
    if shape == "phone":
        return {
            "entity": "phone",
            "shape": shape,
            "touch": True,
            "reason": "values look like phone numbers",
        }
    return {
        "entity": None,
        "shape": shape,
        "touch": True,
        "reason": "text column -- name the entity to mask it",
    }
