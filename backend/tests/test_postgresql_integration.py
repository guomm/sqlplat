"""Opt-in PostgreSQL regression using a dedicated development instance."""
import os
import time
import uuid

import pytest

from app.target import connect_target

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_PG_TESTS") != "1", reason="设置 RUN_PG_TESTS=1 使用专用 PostgreSQL 实例"
)


def test_postgresql_metadata_execution_and_download(admin, app, monkeypatch):
    # A SQL_ASCII client returns even text/varchar as bytes in psycopg.
    monkeypatch.setenv("PGCLIENTENCODING", "SQL_ASCII")
    config = dict(name="PG test", kind="postgresql", host=os.getenv("PGHOST", "127.0.0.1"),
                  port=int(os.getenv("PGPORT", "5432")), username=os.getenv("PGUSER", "postgres"),
                  password=os.getenv("PGPASSWORD", ""), database=os.getenv("PGDATABASE", "postgres"))
    response = admin.post("/api/connections", json=config)
    assert response.status_code == 201, response.text
    cid = response.json()["id"]
    assert "password" not in response.json()
    assert admin.post(f"/api/connections/{cid}/test").status_code == 200
    assert config["database"] in admin.get(f"/api/connections/{cid}/databases").json()
    table = "public.pg_test_" + uuid.uuid4().hex
    schema = "schema_" + uuid.uuid4().hex

    def execute(sql):
        response = admin.post("/api/executions", json={"connection_id": cid, "sql": sql})
        assert response.status_code == 202, response.text
        for _ in range(250):
            task = admin.get("/api/executions/" + response.json()["id"]).json()
            if task["status"] not in ("queued", "running"):
                return task
            time.sleep(.02)
        pytest.fail("PostgreSQL execution did not finish")

    try:
        with connect_target(config, config["password"], 10) as conn:
            assert conn.info.encoding == "utf-8"
            row = conn.execute("SELECT '金价通知'::text, '中文'::varchar, decode('00ff', 'hex')").fetchone()
            assert row == ("金价通知", "中文", b"\x00\xff")
            conn.execute(f'CREATE SCHEMA "{schema}"')
            conn.execute(f'CREATE TABLE "{schema}".other_table(id int)')
        schemas = admin.get(f"/api/connections/{cid}/schemas", params={"database": config["database"]})
        assert schemas.status_code == 200
        assert schema in schemas.json() and "public" in schemas.json()
        assert "information_schema" not in schemas.json()
        task = execute(f"CREATE TABLE {table}(id bigint, amount numeric(30,18), value text); "
                       f"INSERT INTO {table} VALUES(9007199254740993,1.000000000000000001,$tag$中文;a$tag$); "
                       f"SELECT id AS x, amount AS x, value FROM {table}")
        assert task["status"] == "success", task
        assert task["statements"][1]["affected_rows"] == 1
        sid = task["statements"][2]["id"]
        path = f"/api/executions/{task['id']}/results/{sid}"
        result = admin.get(path).json()
        assert result["rows"] == [["9007199254740993", "1.000000000000000001", "中文;a"]]
        assert [c["name"] for c in result["columns"]] == ["x", "x", "value"]
        csv = admin.get(path + "/download?format=csv")
        assert csv.status_code == 200
        assert "中文;a" in csv.content.decode("utf-8-sig")
        assert admin.get(path + "/download?format=xlsx").status_code == 200
        params = {"database": config["database"]}
        assert table in admin.get(f"/api/connections/{cid}/tables", params=params).json()
        filtered = admin.get(f"/api/connections/{cid}/tables", params={**params, "schema": schema}).json()
        assert filtered == [schema + ".other_table"]
        assert table in admin.get(f"/api/connections/{cid}/tables", params={**params, "schema": "public"}).json()
        assert admin.get(f"/api/connections/{cid}/tables", params={**params, "schema": "x' OR true --"}).json() == []
        columns = admin.get(f"/api/connections/{cid}/columns", params={**params, "table": table}).json()
        assert columns[0] == {"Field": "id", "Type": "bigint"}
        failure = execute(f"INVALID SQL; DELETE FROM {table}")
        assert failure["status"] == "failed"
        assert len(failure["statements"]) == 1
        app.state.settings.execution_timeout = 1
        timed_out = execute("SELECT pg_sleep(3); SELECT 2")
        assert timed_out["status"] == "interrupted", timed_out
        assert len(timed_out["statements"]) == 1
    finally:
        with connect_target(config, config["password"], 10) as conn:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
            conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
