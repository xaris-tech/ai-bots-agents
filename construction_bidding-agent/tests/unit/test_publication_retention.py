from app.publisher import consolidation_key


def test_cross_platform_occurrences_share_consolidation_key() -> None:
    first = {
        "platform": "BidNet",
        "bid_id": "BN-10",
        "title": "Main Street Reconstruction",
        "agency": "City of Haslet, TX",
        "due_date": "2099-09-01",
    }
    second = {
        "platform": "CivicEngage",
        "bid_id": "CE-77",
        "title": "Main Street Reconstruction",
        "agency": "Haslet Texas",
        "due_date": "2099-09-01",
    }

    assert consolidation_key(first) == consolidation_key(second)


def test_distinct_agencies_do_not_false_merge_generic_titles() -> None:
    first = {
        "title": "Annual Concrete",
        "agency": "City of Haslet",
        "due_date": "2099-09-01",
    }
    second = {
        "title": "Annual Concrete",
        "agency": "City of Keller",
        "due_date": "2099-09-01",
    }

    assert consolidation_key(first) != consolidation_key(second)
