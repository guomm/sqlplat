"""Opt-in Doris acceptance against an existing, dedicated test database."""

import csv
import io
import os
import time
import uuid

import pytest
from app.target import connect_target, identifier
from openpyxl import load_workbook

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DORIS_TESTS") != "1",
    reason="需要 RUN_DORIS_TESTS=1 和真实 Doris 测试实例",
)


def test_real_doris_ddl_write_query_metadata_and_exports(admin):
    # Require explicit host/database; never fall back to the local MySQL server.
    config = {
        "name": "Doris 临时验收连接",
        "kind": "doris",
        "host": os.environ["DORIS_HOST"],
        "port": int(os.environ.get("DORIS_PORT", "9030")),
        "username": os.environ["DORIS_USER"],
        "password": os.environ["DORIS_PASSWORD"],
        "database": os.environ["DORIS_DATABASE"],
    }
    table = "sqlplat_acceptance_" + uuid.uuid4().hex
    quoted = identifier(table)
    response = admin.post("/api/connections", json=config)
    assert response.status_code == 201
    cid = response.json()["id"]
    assert admin.post(f"/api/connections/{cid}/test").status_code == 200

    def execute(sql):
        response = admin.post(
            "/api/executions",
            json={"connection_id": cid, "database": config["database"], "sql": sql},
        )
        assert response.status_code == 202
        eid = response.json()["id"]
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            task = admin.get(f"/api/executions/{eid}").json()
            if task["status"] not in ("queued", "running"):
                return task
            time.sleep(0.1)
        pytest.fail("Doris 验收任务未在 90 秒内结束")

    try:
        task = execute(
            f"CREATE TABLE {quoted} (id BIGINT, amount DECIMAL(30,18), "
            "text_value VARCHAR(80), dt DATETIME) "
            "DUPLICATE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 "
            'PROPERTIES("replication_num"="1"); '
            f"INSERT INTO {quoted} VALUES "
            "(9007199254740993,1.000000000000000001,'中文','2026-10-09 10:00:00'),"
            "(2,NULL,'=1+1',NULL); "
            f"SELECT id AS x,amount AS x,text_value,dt FROM {quoted} ORDER BY id DESC;"
        )
        assert task["status"] == "success", task["error"]
        assert task["statements"][1]["affected_rows"] == 2
        statement = task["statements"][2]
        path = f"/api/executions/{task['id']}/results/{statement['id']}"
        result = admin.get(path).json()
        assert [column["name"] for column in result["columns"]][:2] == ["x", "x"]
        assert result["rows"] == [
            ["9007199254740993", "1.000000000000000001", "中文", "2026-10-09T10:00:00"],
            [2, None, "=1+1", None],
        ]
        csv_response = admin.get(path + "/download?format=csv")
        assert csv_response.status_code == 200
        rows = list(csv.reader(io.StringIO(csv_response.content.decode("utf-8-sig"))))
        assert rows[2][2] == "'=1+1"
        xlsx_response = admin.get(path + "/download?format=xlsx")
        assert xlsx_response.status_code == 200
        workbook = load_workbook(io.BytesIO(xlsx_response.content))
        assert workbook.active["A2"].value == "9007199254740993"
        assert workbook.active["C3"].data_type == "s"
        assert (
            config["database"] in admin.get(f"/api/connections/{cid}/databases").json()
        )
        assert (
            table
            in admin.get(
                f"/api/connections/{cid}/tables",
                params={"database": config["database"]},
            ).json()
        )
        columns = admin.get(
            f"/api/connections/{cid}/columns",
            params={"database": config["database"], "table": table},
        ).json()
        assert columns[0]["Field"] == "id"
        failure = execute(f"SELECT * FROM {quoted}; INVALID SQL; DROP TABLE {quoted};")
        assert failure["status"] == "failed"
        assert len(failure["statements"]) == 2
        remaining = execute(f"SELECT COUNT(*) FROM {quoted};")
        assert remaining["status"] == "success", remaining["error"]
        drop = execute(f"DROP TABLE {quoted};")
        assert drop["status"] == "success", drop["error"]
    finally:
        target = connect_target(config, config["password"], 10)
        try:
            with target.cursor() as cursor:
                cursor.execute(f"DROP TABLE IF EXISTS {quoted}")
        finally:
            target.close()
