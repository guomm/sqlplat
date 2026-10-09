"""Exercise repeatable-read snapshots in an isolated local MySQL database."""

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.config import Settings
from app.main import create_app
from app.models import Base, User
from app.security import hash_password
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text


@pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1", reason="需要本地 MySQL")
@pytest.mark.parametrize("operation", ["create", "update"])
def test_saved_sql_binding_sees_concurrent_connection_deletion(tmp_path, operation):
    settings = Settings()
    root_engine = create_engine(settings.database_url)
    database = "sqlplat_delete_test_" + uuid.uuid4().hex[:12]
    engine = None
    with root_engine.begin() as db:
        db.execute(text(f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4"))
    try:
        config = settings.model_copy(
            update={
                "database_url": root_engine.url.set(database=database).render_as_string(
                    hide_password=False
                ),
                "result_dir": tmp_path / "results",
                "cookie_secure": False,
            }
        )
        app = create_app(config)
        engine = app.state.db.kw["bind"]
        Base.metadata.create_all(engine)
        with app.state.db() as db:
            db.add(
                User(
                    username="admin",
                    password_hash=hash_password("test-password"),
                    role="admin",
                )
            )
            db.commit()
        with TestClient(app) as client:
            login = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "test-password"},
            ).json()
            client.headers["X-CSRF-Token"] = login["csrf_token"]
            connection = client.post(
                "/api/connections",
                json={
                    "name": "并发删除测试",
                    "kind": "mysql",
                    "host": "localhost",
                    "port": 3306,
                    "username": "test",
                    "password": "",
                },
            ).json()
            payload = {
                "name": "保存查询",
                "sql": "SELECT 1",
                "connection_id": connection["id"],
            }
            url, method = "/api/saved-queries", client.post
            if operation == "update":
                saved = client.post(
                    url, json={"name": "原查询", "sql": "SELECT 42"}
                ).json()
                url, method = url + "/" + saved["id"], client.put

            paused, release = threading.Event(), threading.Event()
            guard, first = threading.Lock(), [True]

            def pause_validation(
                conn, cursor, statement, parameters, context, executemany
            ):
                if not (
                    statement.startswith("SELECT connections.")
                    and "WHERE connections.id" in statement
                ):
                    return
                with guard:
                    if not first[0]:
                        return
                    first[0] = False
                # Authentication has already established a repeatable-read snapshot.
                # Delete commits before the connection validation query starts.
                paused.set()
                if not release.wait(10):
                    raise RuntimeError("测试连接校验等待超时")

            event.listen(engine, "before_cursor_execute", pause_validation)
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(method, url, json=payload)
                    try:
                        assert paused.wait(5)
                        assert (
                            client.delete(
                                f"/api/connections/{connection['id']}"
                            ).status_code
                            == 204
                        )
                    finally:
                        release.set()
                    assert future.result(timeout=5).status_code == 404
                if operation == "update":
                    assert client.get(url).json()["sql"] == "SELECT 42"
                else:
                    assert client.get("/api/saved-queries").json()["total"] == 0
            finally:
                release.set()
                event.remove(engine, "before_cursor_execute", pause_validation)
    finally:
        if engine is not None:
            engine.dispose()
        with root_engine.begin() as db:
            db.execute(text(f"DROP DATABASE `{database}`"))
        root_engine.dispose()
