import threading
import time
from sqlalchemy import select


def test_pool_capacity_is_bounded():
    from app.executor import BoundedPool

    pool = BoundedPool(1, 1)
    gate = threading.Event()
    assert pool.acquire()
    pool.submit(lambda: gate.wait(3))
    assert pool.acquire()
    pool.submit(lambda: gate.wait(3))
    assert not pool.acquire()
    gate.set()
    pool.shutdown()


def test_connection_configuration_never_exposes_password(admin, app):
    payload = {
        "name": "test",
        "kind": "mysql",
        "host": "localhost",
        "port": 3306,
        "username": "reader",
        "password": "database-secret",
    }
    res = admin.post("/api/connections", json=payload)
    assert res.status_code == 201
    assert "database-secret" not in res.text
    assert "password_cipher" not in res.text
    from app.models import Connection

    with app.state.db() as db:
        item = db.scalar(select(Connection))
        assert item.password_cipher != "database-secret"
        assert (
            app.state.settings.crypto().decrypt(item.password_cipher.encode()).decode()
            == "database-secret"
        )


def test_history_isolated_and_disabled_connection_rejected(admin, app):
    from app.models import Connection, Execution
    from app.security import hash_password

    with app.state.db() as db:
        c = Connection(
            name="off",
            kind="mysql",
            host="host",
            port=3306,
            username="u",
            password_cipher="x",
            enabled=False,
        )
        db.add(c)
        db.flush()
        execution = Execution(
            user_id=2,
            connection_id=c.id,
            connection_name="off",
            sql="SELECT 1",
            status="success",
        )
        db.add(execution)
        db.commit()
        eid, cid = execution.id, c.id
    assert admin.get("/api/executions/" + eid).status_code == 404
    assert admin.get("/api/executions").json()["items"] == []
    assert (
        admin.post(
            "/api/executions", json={"connection_id": cid, "sql": "SELECT 1"}
        ).status_code
        == 409
    )
