from datetime import timedelta
from decimal import Decimal
import json
import time
from sqlalchemy import select
import pytest
from app.models import Connection, Execution, Statement, utcnow


class TargetCursor:
    def __init__(self, owner):
        self.owner = owner
        self.description = None
        self.rowcount = 0
        self.rows = iter([])

    def execute(self, sql, params=None):
        self.owner.executed.append(sql)
        if sql.startswith("SET "):
            return
        if sql == "BAD":
            import pymysql

            raise pymysql.ProgrammingError(1064, "syntax error")
        if sql == "SLOW":
            time.sleep(1.2)
        if sql.startswith("SELECT") or sql == "SLOW":
            self.description = [("x", 246), ("x", 8)]
            self.rows = iter(
                [
                    (Decimal("1.000000000000000001"), 9007199254740993),
                    (None, 2),
                    ("中文", 3),
                ]
            )
        else:
            self.rowcount = 2

    def fetchmany(self, size=1):
        from itertools import islice

        return list(islice(self.rows, size))

    def nextset(self):
        return None

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class Target:
    def __init__(self):
        self.executed = []
        self.closed = False

    def cursor(self):
        return TargetCursor(self)

    def close(self):
        self.closed = True


def seed(app, sql, status="queued"):
    with app.state.db() as db:
        c = Connection(
            name="target",
            kind="mysql",
            host="h",
            port=3306,
            username="u",
            password_cipher=app.state.settings.crypto().encrypt(b"p").decode(),
            enabled=True,
        )
        db.add(c)
        db.flush()
        task = Execution(
            user_id=1,
            connection_id=c.id,
            connection_name="target",
            sql=sql,
            status=status,
        )
        db.add(task)
        db.commit()
        return task.id, c.password_cipher


def run(app, monkeypatch, sql):
    target = Target()
    monkeypatch.setattr("app.executor.connect_target", lambda *args: target)
    eid, secret = seed(app, sql)
    app.state.runner.run(eid, {"kind": "mysql"}, secret)
    return eid, target


def test_worker_preserves_types_and_stops_after_error(app, monkeypatch):
    eid, target = run(
        app, monkeypatch, "USE example; UPDATE t SET x=1; SELECT 1; BAD; SELECT 2;"
    )
    with app.state.db() as db:
        task = db.get(Execution, eid)
        statements = db.scalars(
            select(Statement)
            .where(Statement.execution_id == eid)
            .order_by(Statement.ordinal)
        ).all()
        assert task.status == "failed"
        assert len(statements) == 4
        assert statements[1].affected_rows == 2
        assert statements[2].columns == [
            {"name": "x", "type": 246},
            {"name": "x", "type": 8},
        ]
        rows = app.state.store.page(statements[2].file_name, 0, 10)
        assert rows[0] == ["1.000000000000000001", "9007199254740993"]
        assert rows[1] == [None, 2]
        assert "SELECT 2" not in target.executed
        assert target.closed


def test_row_limit_drains_and_next_statement_runs(app, monkeypatch):
    app.state.settings.result_rows = 1
    eid, target = run(app, monkeypatch, "SELECT 1; UPDATE t SET x=2;")
    with app.state.db() as db:
        statements = db.scalars(
            select(Statement)
            .where(Statement.execution_id == eid)
            .order_by(Statement.ordinal)
        ).all()
        assert statements[0].truncated and statements[0].saved_rows == 1
        assert statements[1].status == "success" and statements[1].affected_rows == 2
        assert db.get(Execution, eid).status == "success"


def test_size_limit_stops_remaining_sql(app, monkeypatch):
    app.state.settings.result_bytes = 1
    eid, target = run(app, monkeypatch, "SELECT 1; UPDATE t SET x=2;")
    with app.state.db() as db:
        assert db.get(Execution, eid).status == "interrupted"
        statement = db.scalar(select(Statement).where(Statement.execution_id == eid))
        assert statement.truncated and statement.saved_rows == 0
        assert "UPDATE t SET x=2" not in target.executed


def test_deadline_marks_unknown_write_state(app, monkeypatch):
    app.state.settings.execution_timeout = 1
    eid, _ = run(app, monkeypatch, "SLOW; UPDATE t SET x=2;")
    with app.state.db() as db:
        task = db.get(Execution, eid)
        assert task.status == "interrupted"
        assert "写入可能已生效" in task.error


def test_restart_recovers_tasks_without_reexecution(app):
    eid, _ = seed(app, "UPDATE t SET x=1", "running")
    app.state.runner.recover()
    with app.state.db() as db:
        assert db.get(Execution, eid).status == "interrupted"


def test_expired_results_and_history_ownership(admin, app, monkeypatch):
    eid, _ = run(app, monkeypatch, "SELECT 1")
    task = admin.get("/api/executions/" + eid).json()
    sid = task["statements"][0]["id"]
    route = f"/api/executions/{eid}/results/{sid}"
    assert admin.get(route).json()["rows"][0] == [
        "1.000000000000000001",
        "9007199254740993",
    ]
    assert admin.get(route + "/download?format=xlsx").status_code == 200
    with app.state.db() as db:
        db.get(Statement, sid).expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert admin.get(route).status_code == 410
    assert admin.get("/api/executions/" + eid).status_code == 200
    app.state.runner.clean()
    with app.state.db() as db:
        assert db.get(Statement, sid).file_name == ""
    v = admin.post(
        "/api/auth/login", json={"username": "other", "password": "other-password"}
    ).json()
    admin.headers["X-CSRF-Token"] = v["csrf_token"]
    assert admin.get(route + "/download").status_code == 404


def test_async_submission_completes_without_blocking_api(admin, app, monkeypatch):
    target = Target()
    monkeypatch.setattr("app.executor.connect_target", lambda *args: target)
    _, _ = seed(app, "SELECT 1", "success")
    with app.state.db() as db:
        cid = db.scalar(select(Connection.id))
    response = admin.post(
        "/api/executions", json={"connection_id": cid, "sql": "SELECT 1"}
    )
    assert response.status_code == 202
    eid = response.json()["id"]
    for _ in range(100):
        detail = admin.get("/api/executions/" + eid).json()
        if detail["status"] not in ("queued", "running"):
            break
        time.sleep(0.02)
    assert detail["status"] == "success"


def test_server_timeout_is_interrupted_not_sql_failure(app, monkeypatch):
    import pymysql

    target = Target()
    original = TargetCursor.execute

    def execute(cursor, sql, params=None):
        if sql == "SERVER_TIMEOUT":
            raise pymysql.OperationalError(
                3024,
                "Query execution was interrupted, maximum statement execution time exceeded",
            )
        return original(cursor, sql, params)

    monkeypatch.setattr(TargetCursor, "execute", execute)
    monkeypatch.setattr("app.executor.connect_target", lambda *args: target)
    eid, secret = seed(app, "SERVER_TIMEOUT")
    app.state.runner.run(eid, {"kind": "mysql"}, secret)
    with app.state.db() as db:
        assert db.get(Execution, eid).status == "interrupted"


def test_doris_adapter_sets_query_timeout_and_uses_same_session(app, monkeypatch):
    target = Target()
    monkeypatch.setattr("app.executor.connect_target", lambda *args: target)
    eid, secret = seed(app, "USE example; SELECT 1;")
    app.state.runner.run(eid, {"kind": "doris"}, secret)
    with app.state.db() as db:
        assert db.get(Execution, eid).status == "success"
    assert target.executed == ["SET query_timeout = %s", "USE example", "SELECT 1"]
