import json
from pathlib import Path


def test_statement_boundaries_ignore_quotes_and_comments():
    from app.sql import split_statements, statement_at

    sql = "SELECT ';' AS x; -- a; comment\nSELECT 2 /* ; */;"
    parts = split_statements(sql)
    assert [p["sql"] for p in parts] == [
        "SELECT ';' AS x",
        "-- a; comment\nSELECT 2 /* ; */",
    ]
    assert statement_at(sql, sql.index("SELECT 2")) == "-- a; comment\nSELECT 2 /* ; */"


def test_empty_and_comment_only_sql_is_not_executed():
    from app.sql import split_statements

    assert split_statements("-- comment;\n /* more */ ;") == []


def test_unclosed_quotes_rejected():
    import pytest
    from app.sql import split_statements

    with pytest.raises(ValueError):
        split_statements("SELECT 'oops")


def test_shared_sql_fixtures():
    from app.sql import split_statements

    for case in json.loads(
        (Path(__file__).parents[2] / "shared/sql-cases.json").read_text()
    ):
        assert [p["sql"] for p in split_statements(case["input"])] == case["expected"]
