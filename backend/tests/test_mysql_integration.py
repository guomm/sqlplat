"""Opt-in real MySQL test. Uses credentials from local .env, creates its own table."""

import os
import time
import uuid
import io
import csv
import pytest
import pymysql
from openpyxl import load_workbook
from sqlalchemy import create_engine
from app.config import Settings

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MYSQL_TESTS") != "1",
    reason="设置 RUN_MYSQL_TESTS=1 以连接本地 MySQL",
)


def test_real_mysql_query_write_metadata_and_download(admin):
    settings = Settings()
    url = create_engine(settings.database_url).url
    table = "atelier_test_" + uuid.uuid4().hex[:12]
    config = {
        "name": "本地集成测试",
        "kind": "mysql",
        "host": url.host,
        "port": url.port or 3306,
        "username": url.username,
        "password": url.password,
        "database": "sqlplat_demo",
    }
    response = admin.post("/api/connections", json=config)
    assert response.status_code == 201
    cid = response.json()["id"]
    assert admin.post(f"/api/connections/{cid}/test").status_code == 200
    assert "sqlplat_demo" in admin.get(f"/api/connections/{cid}/databases").json()

    def execute(sql):
        response = admin.post(
            "/api/executions",
            json={"connection_id": cid, "database": "sqlplat_demo", "sql": sql},
        )
        assert response.status_code == 202
        eid = response.json()["id"]
        for _ in range(200):
            task = admin.get("/api/executions/" + eid).json()
            if task["status"] not in ("queued", "running"):
                return task
            time.sleep(0.02)
        pytest.fail("真实 MySQL 执行超时")

    try:
        task = execute(
            f"CREATE TABLE `{table}`(id BIGINT, amount DECIMAL(30,18), text_value VARCHAR(80), dt DATETIME); INSERT INTO `{table}` VALUES (9007199254740993,1.000000000000000001,'中文','2026-10-09 10:00:00'),(2,NULL,'=1+1',NULL); UPDATE `{table}` SET text_value='中文更新' WHERE id=9007199254740993; SELECT id AS x, amount AS x, text_value, dt FROM `{table}` ORDER BY id DESC;"
        )
        assert task["status"] == "success", task["error"]
        assert task["statements"][1]["affected_rows"] == 2
        assert task["statements"][2]["affected_rows"] == 1
        sid = task["statements"][3]["id"]
        path = f"/api/executions/{task['id']}/results/{sid}"
        result = admin.get(path).json()
        assert result["rows"][0] == [
            "9007199254740993",
            "1.000000000000000001",
            "中文更新",
            "2026-10-09T10:00:00",
        ]
        assert result["rows"][1] == [2, None, "=1+1", None]
        assert [c["name"] for c in result["columns"]][:2] == ["x", "x"]
        raw = admin.get(path + "/download?format=csv")
        rows = list(csv.reader(io.StringIO(raw.content.decode("utf-8-sig"))))
        assert rows[2][2] == "'=1+1"
        wb = load_workbook(
            io.BytesIO(admin.get(path + "/download?format=xlsx").content)
        )
        assert wb.active["A2"].value == "9007199254740993"
        assert wb.active["C3"].data_type == "s"
        tables = admin.get(
            f"/api/connections/{cid}/tables?database=sqlplat_demo"
        ).json()
        assert table in tables
        columns = admin.get(
            f"/api/connections/{cid}/columns?database=sqlplat_demo&table={table}"
        ).json()
        assert columns[0]["Field"] == "id"
        failure = execute(
            f"SELECT * FROM `{table}`; INVALID SQL; DELETE FROM `{table}`;"
        )
        assert failure["status"] == "failed" and len(failure["statements"]) == 2
        assert execute(f"SELECT COUNT(*) FROM `{table}`")["status"] == "success"
    finally:
        conn = pymysql.connect(
            host=url.host,
            port=url.port or 3306,
            user=url.username,
            password=url.password,
            database="sqlplat_demo",
            autocommit=True,
        )
        with conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS `{table}`")
        conn.close()


def test_large_sql_is_persisted_without_mysql_text_limit(admin):
    settings = Settings()
    url = create_engine(settings.database_url).url
    config = {
        "name": "长 SQL 测试",
        "kind": "mysql",
        "host": url.host,
        "port": url.port or 3306,
        "username": url.username,
        "password": url.password,
        "database": "sqlplat_demo",
    }
    cid = admin.post("/api/connections", json=config).json()["id"]
    sql = "/*" + "x" * 70000 + "*/ SELECT 1"
    response = admin.post("/api/executions", json={"connection_id": cid, "sql": sql})
    assert response.status_code == 202


def test_platform_mysql_stores_large_sql():
    from sqlalchemy.orm import Session
    from app.models import User, Connection, Execution

    settings = Settings()
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        try:
            user = User(
                username="test_" + uuid.uuid4().hex[:12],
                password_hash="unused",
                role="user",
            )
            connection = Connection(
                name="temporary",
                kind="mysql",
                host="localhost",
                port=3306,
                username="u",
                password_cipher="unused",
            )
            db.add_all([user, connection])
            db.flush()
            text = "/*" + "x" * 70000 + "*/ SELECT 1"
            from datetime import datetime

            execution = Execution(
                user_id=user.id,
                connection_id=connection.id,
                connection_name="temporary",
                sql=text,
                status="success",
                created_at=datetime(2026, 10, 9, 10, 0, 0, 123456),
            )
            db.add(execution)
            db.flush()
            db.expire(execution)
            assert execution.sql == text
            assert execution.created_at.microsecond == 123456
        finally:
            db.rollback()
    engine.dispose()


def test_default_target_cannot_read_platform_users():
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from app.models import Connection
    from app.target import connect_target
    from app.main import snapshot

    settings = Settings()
    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        connection = db.scalar(
            select(Connection).where(Connection.name == "本地 MySQL")
        )
        secret = settings.crypto().decrypt(connection.password_cipher.encode()).decode()
        target = connect_target(snapshot(connection), secret, 5)
        try:
            with target.cursor() as cursor:
                with pytest.raises(pymysql.err.OperationalError):
                    cursor.execute("SELECT username FROM sqlplat.users")
        finally:
            target.close()
    engine.dispose()


def test_real_mysql_large_result_truncates_and_continues(admin):
    settings = Settings()
    url = create_engine(settings.database_url).url
    config = {
        "name": "结果截断测试",
        "kind": "mysql",
        "host": url.host,
        "port": url.port or 3306,
        "username": url.username,
        "password": url.password,
        "database": "sqlplat_demo",
    }
    cid = admin.post("/api/connections", json=config).json()["id"]
    digits = " UNION ALL ".join("SELECT " + str(i) + " AS n" for i in range(10))
    sql = (
        "SELECT a.n FROM "
        + " CROSS JOIN ".join(f"({digits}) {alias}" for alias in "abcde")
        + " UNION ALL SELECT 9; SELECT 42 AS next_statement;"
    )
    response = admin.post("/api/executions", json={"connection_id": cid, "sql": sql})
    assert response.status_code == 202
    eid = response.json()["id"]
    for _ in range(1000):
        task = admin.get("/api/executions/" + eid).json()
        if task["status"] not in ("queued", "running"):
            break
        time.sleep(0.02)
    assert task["status"] == "success", task["error"]
    first = task["statements"][0]
    assert first["saved_rows"] == 100000 and first["truncated"]
    path = f"/api/executions/{eid}/results/{first['id']}"
    assert admin.get(path).json()["total"] == 1000
    assert admin.get(path + "?offset=1000").json()["rows"] == []
    raw = admin.get(path + "/download?format=csv").content
    assert len(list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))) == 100001
    assert task["statements"][1]["saved_rows"] == 1


def test_platform_mysql_stores_saved_query_long_sql():
    from sqlalchemy.orm import Session
    from app.models import SavedQuery, User

    engine = create_engine(Settings().database_url)
    with Session(engine) as db:
        try:
            user = User(username="saved_test_" + uuid.uuid4().hex[:12], password_hash="unused")
            db.add(user)
            db.flush()
            text = "/*" + "x" * 70000 + "*/ SELECT 1;"
            saved = SavedQuery(user_id=user.id, name="保存测试", sql=text)
            db.add(saved)
            db.flush()
            db.expire(saved)
            assert saved.sql == text
            assert saved.connection_id is None
        finally:
            db.rollback()
    engine.dispose()
