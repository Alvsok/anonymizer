from datetime import date

from heuristics import guess_column, guess_shape


def test_guess_shape_numeric():
    assert guess_shape([100, 200.5, 0]) == "numeric"


def test_guess_shape_date():
    assert guess_shape([date(2026, 1, 1), date(2026, 1, 2)]) == "date"


def test_guess_shape_empty():
    assert guess_shape([None, "", None]) == "empty"


def test_guess_shape_email():
    assert guess_shape(["a@b.com", "c@d.io"]) == "email"


def test_guess_shape_phone():
    assert guess_shape(["+1 415 123-45-67", "(999) 111-22-33"]) == "phone"


def test_guess_shape_text_fallback():
    assert guess_shape(["Acme Inc", "Globex LLC"]) == "text"


def test_guess_shape_mixed_types_falls_back_to_text():
    # mixed values must not be misdetected as numeric/date
    assert guess_shape([100, "text"]) == "text"


def test_guess_column_numeric_not_touched():
    result = guess_column([100, 200, 300])
    assert result["touch"] is False
    assert result["entity"] is None


def test_guess_column_date_not_touched():
    result = guess_column([date(2026, 1, 1)])
    assert result["touch"] is False


def test_guess_column_empty_not_touched():
    result = guess_column([None, "", None])
    assert result["touch"] is False


def test_guess_column_email_entity_comes_from_the_values():
    # The only case where an entity is filled in: the values themselves say
    # what they are. The heading plays no part -- see the regression guard
    # at the bottom of this file.
    result = guess_column(["a@b.com", "c@d.com"])
    assert result["entity"] == "email"
    assert result["touch"] is True


def test_guess_column_phone_entity_comes_from_the_values():
    result = guess_column(["+1 415 123-45-67", "(999) 111-22-33"])
    assert result["entity"] == "phone"
    assert result["touch"] is True


def test_guess_column_text_proposed_but_entity_left_to_the_client():
    # design.md §7 (owner's decision 2026-08-20): column headings are not
    # analyzed at all. A text column is proposed for masking, but naming the
    # entity is the client's job (requirements.md §6) -- a pre-filled wrong
    # guess is worse than an empty field.
    result = guess_column(["Acme Inc", "Globex LLC"])
    assert result["touch"] is True
    assert result["entity"] is None
    assert result["reason"]  # design.md §7: silent skipping is forbidden


def test_guess_column_takes_no_heading_argument():
    # Regression guard for the decision above: guess_column must not grow a
    # column-name parameter back. If it does, this fails loudly instead of
    # the heading quietly influencing results again.
    import inspect

    assert list(inspect.signature(guess_column).parameters) == ["sample_values"]


# ---- CSV has no types: strings must still be recognized (v1-beta.md, step 3) ----


def test_guess_shape_numeric_strings_from_csv():
    # csv.reader hands back str for every cell; a column of amounts must not
    # end up as text, or it would arrive pre-ticked for masking
    assert guess_shape(["120000", "85000", "-450.75", "+12"]) == "numeric"


def test_guess_shape_date_strings_from_csv():
    assert guess_shape(["2026-01-15", "2026-02-02"]) == "date"
    assert guess_shape(["15.01.2026", "02.02.2026"]) == "date"
    assert guess_shape(["2026-01-15 10:30", "2026-02-02T09:00:00"]) == "date"


def test_date_string_wins_over_phone_pattern():
    # PHONE_RE matches any 7-20 chars of digits, spaces, brackets and dashes,
    # which includes "2026-01-15". The date check has to run first.
    assert guess_shape(["2026-01-15", "2026-01-18"]) == "date"


def test_guess_column_numeric_strings_not_proposed_for_masking():
    result = guess_column(["120000", "85000"])
    assert result["touch"] is False
    assert result["shape"] == "numeric"


def test_guess_column_date_strings_not_proposed_for_masking():
    result = guess_column(["2026-01-15", "2026-02-02"])
    assert result["touch"] is False
    assert result["shape"] == "date"


def test_real_phone_numbers_still_recognized():
    # The recognition above must not have made the phone branch unreachable:
    # phones are PII and have to keep being proposed for masking.
    result = guess_column(["+1 415 123-45-67", "(999) 111-22-33"])
    assert result["shape"] == "phone"
    assert result["touch"] is True


def test_mixed_numbers_and_text_stays_text():
    # One non-numeric value is enough to keep the whole column text -- the
    # safe direction, the client unticks it if it is wrong
    assert guess_shape(["120000", "n/a", "85000"]) == "text"
