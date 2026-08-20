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
