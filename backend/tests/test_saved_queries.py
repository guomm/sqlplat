from app.models import Connection


def payload(**changes):
    return {"name": "  我的查询  ", "sql": "SELECT 1; SELECT 2;", **changes}


def test_crud_search_and_pagination(admin):
    created = admin.post("/api/saved-queries", json=payload())
    assert created.status_code == 201
    item = created.json()
    assert item["name"] == "我的查询"
    assert item["connection_id"] is None
    assert (
        admin.get("/api/saved-queries", params={"q": "SELECT 2"}).json()["total"] == 1
    )
    assert admin.get("/api/saved-queries", params={"q": "我的"}).json()["total"] == 1
    assert admin.get("/api/saved-queries", params={"q": "%"}).json()["total"] == 0
    assert admin.get("/api/saved-queries", params={"page": 2}).json()["items"] == []
    url = "/api/saved-queries/" + item["id"]
    assert admin.put(url, json=payload(name="改名", sql="SELECT 3")).status_code == 200
    assert admin.get(url).json()["sql"] == "SELECT 3"
    assert admin.delete(url).status_code == 204
    assert admin.get(url).status_code == 404
    assert admin.put(url, json=payload()).status_code == 404


def test_owner_and_csrf(admin):
    # Normal user's record remains inaccessible even to an administrator.
    response = admin.post(
        "/api/auth/login", json={"username": "other", "password": "other-password"}
    )
    admin.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    item = admin.post("/api/saved-queries", json=payload()).json()
    response = admin.post(
        "/api/auth/login", json={"username": "admin", "password": "admin-password"}
    )
    admin.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    url = "/api/saved-queries/" + item["id"]
    assert admin.get("/api/saved-queries").json()["total"] == 0
    assert admin.get(url).status_code == 404
    assert admin.put(url, json=payload()).status_code == 404
    assert admin.delete(url).status_code == 404
    admin.headers.pop("X-CSRF-Token")
    assert admin.post("/api/saved-queries", json=payload()).status_code == 403
    admin.cookies.clear()
    assert admin.get("/api/saved-queries").status_code == 401


def test_validation_and_optional_connection(admin, app):
    for changes in (
        {"name": "  "},
        {"sql": " \n "},
        {"name": "x" * 101},
        {"sql": "x" * 1000001},
    ):
        assert (
            admin.post("/api/saved-queries", json=payload(**changes)).status_code == 422
        )
    assert (
        admin.post("/api/saved-queries", json=payload(connection_id=999)).status_code
        == 404
    )
    with app.state.db() as db:
        c = Connection(
            name="禁用连接",
            kind="mysql",
            host="localhost",
            port=3306,
            username="u",
            password_cipher="unused",
            enabled=False,
        )
        db.add(c)
        db.commit()
        cid = c.id
    assert (
        admin.post(
            "/api/saved-queries",
            json=payload(connection_id=cid, sql="SELECT 'unfinished"),
        ).status_code
        == 201
    )
    assert admin.get("/api/saved-queries?page=0").status_code == 422


def test_rename_preserves_latest_content_and_trims_before_length(admin):
    created = admin.post("/api/saved-queries", json=payload(name=" " + "x" * 100 + " "))
    assert created.status_code == 201
    item = created.json()
    url = "/api/saved-queries/" + item["id"]
    assert (
        admin.put(url, json=payload(sql="SELECT 99", database="new_db")).status_code
        == 200
    )
    renamed = admin.patch(url, json={"name": "  新名称  "})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "新名称"
    assert renamed.json()["sql"] == "SELECT 99"
    assert renamed.json()["database"] == "new_db"


def test_pagination_and_rename_owner(admin):
    ids = [
        admin.post("/api/saved-queries", json=payload(name=f"query-{i}")).json()["id"]
        for i in range(21)
    ]
    first = admin.get("/api/saved-queries").json()
    second = admin.get("/api/saved-queries?page=2").json()
    assert first["total"] == second["total"] == 21
    assert len(first["items"]) == 20 and len(second["items"]) == 1
    assert not {v["id"] for v in first["items"]} & {v["id"] for v in second["items"]}
    response = admin.post(
        "/api/auth/login", json={"username": "other", "password": "other-password"}
    )
    admin.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    assert (
        admin.patch(
            "/api/saved-queries/" + ids[0], json={"name": "changed"}
        ).status_code
        == 404
    )
