from links import propose_links


def col(file, sheet, column, entity=None, values=None):
    return {"file": file, "sheet": sheet, "column": column, "entity": entity, "values": values or []}


def test_same_entity_proposes_link():
    columns = [
        col("orders.xlsx", "Orders", "counterparty", entity="customer"),
        col("customers.xlsx", "Customers", "name", entity="customer"),
    ]
    links = propose_links(columns)
    assert len(links) == 1
    assert "same entity" in links[0]["reason"]


def test_different_entities_no_link_from_name_alone():
    columns = [
        col("orders.xlsx", "Orders", "counterparty", entity="customer"),
        col("orders.xlsx", "Orders", "product", entity="product"),
    ]
    assert propose_links(columns) == []


def test_value_overlap_above_threshold_proposes_link():
    values_a = [f"Customer {i}" for i in range(100)]
    values_b = values_a[:96]  # 96% overlap with A
    columns = [
        col("orders.xlsx", "Orders", "customer_id", values=values_a),
        col("customers.xlsx", "Customers", "id", values=values_b),
    ]
    links = propose_links(columns)
    assert len(links) == 1
    assert "value overlap" in links[0]["reason"]


def test_value_overlap_below_threshold_no_link():
    # B is not a subset of A: only 50 of 100 overlap in either direction
    # (containment is 50% both ways, below the 95% threshold regardless of
    # direction, not just for "A inside B")
    values_a = [f"Customer {i}" for i in range(100)]
    values_b = [f"Customer {i}" for i in range(50, 150)]
    columns = [
        col("orders.xlsx", "Orders", "customer_id", values=values_a),
        col("customers.xlsx", "Customers", "id", values=values_b),
    ]
    assert propose_links(columns) == []


def test_overlap_is_directional_smaller_set_contained_in_larger():
    # A is small but fully contained in B -- containment(A, B) is 100% even
    # though containment(B, A) is low. We take the max over both directions.
    values_a = [f"Customer {i}" for i in range(10)]
    values_b = [f"Customer {i}" for i in range(1000)]
    columns = [
        col("a.xlsx", "Sheet1", "col_a", values=values_a),
        col("b.xlsx", "Sheet1", "col_b", values=values_b),
    ]
    links = propose_links(columns)
    assert len(links) == 1


def test_same_column_not_compared_to_itself():
    columns = [
        col("orders.xlsx", "Orders", "counterparty", entity="customer", values=["a", "b"]),
        col("orders.xlsx", "Orders", "counterparty", entity="customer", values=["a", "b"]),
    ]
    # two identical descriptors (file+sheet+column) are not a link, they are
    # the very same column
    assert propose_links(columns) == []


def test_no_reason_no_link():
    columns = [
        col("a.xlsx", "Sheet1", "col_a", entity=None, values=["x", "y"]),
        col("b.xlsx", "Sheet1", "col_b", entity=None, values=["z", "w"]),
    ]
    assert propose_links(columns) == []


def test_both_reasons_combined_in_one_link():
    values = [f"v{i}" for i in range(50)]
    columns = [
        col("a.xlsx", "Sheet1", "col_a", entity="customer", values=values),
        col("b.xlsx", "Sheet1", "col_b", entity="customer", values=values),
    ]
    links = propose_links(columns)
    assert len(links) == 1
    assert "same entity" in links[0]["reason"]
    assert "value overlap" in links[0]["reason"]


def test_three_columns_all_pairs_considered():
    values = [f"v{i}" for i in range(50)]
    columns = [
        col("a.xlsx", "Sheet1", "col_a", values=values),
        col("b.xlsx", "Sheet1", "col_b", values=values),
        col("c.xlsx", "Sheet1", "col_c", values=values),
    ]
    links = propose_links(columns)
    assert len(links) == 3  # a-b, a-c, b-c
