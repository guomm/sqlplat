import asyncio
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .executor import Executor
from .models import Connection, Execution, LoginSession, Statement, User, utcnow
from .results import LeasedStreamingResponse, ResultStore
from .saved_queries import register_saved_queries
from .schemas import (
    ConnectionInput,
    ExecutionInput,
    Login,
    PasswordChange,
    UserCreate,
    UserPatch,
)
from .security import digest, hash_password, verify_password
from .sql import validate_sql
from .target import connect_target, identifier


def user_public(user):
    return {k: getattr(user, k) for k in ("id", "username", "role", "enabled")}


def connection_public(conn, admin=False):
    keys = ("id", "name", "kind", "database", "enabled")
    if admin:
        keys += ("host", "port", "username", "tls")
    return {k: getattr(conn, k) for k in keys}


def snapshot(conn):
    return {
        k: getattr(conn, k)
        for k in ("host", "port", "username", "database", "tls", "kind")
    }


def create_app(settings=None):
    settings = settings or Settings()
    settings.crypto()  # Validate persistent key before accepting requests.
    kwargs = (
        {"connect_args": {"check_same_thread": False}}
        if settings.database_url.startswith("sqlite")
        else {}
    )
    engine = create_engine(settings.database_url, pool_pre_ping=True, **kwargs)
    db_factory = sessionmaker(engine, expire_on_commit=False)
    store = ResultStore(settings.result_dir)
    runner = Executor(settings, db_factory, store)

    @asynccontextmanager
    async def lifespan(app):
        runner.recover()
        runner.clean()

        async def cleaning():
            while True:
                await asyncio.sleep(3600)
                try:
                    await asyncio.to_thread(runner.clean)
                except Exception:
                    import logging

                    logging.getLogger(__name__).exception("Result cleanup failed")

        cleanup = asyncio.create_task(cleaning())
        yield
        cleanup.cancel()
        try:
            await cleanup
        except asyncio.CancelledError:
            pass
        await asyncio.to_thread(runner.pool.shutdown)
        engine.dispose()

    app = FastAPI(title="SQL Atelier", lifespan=lifespan)
    app.state.settings, app.state.db, app.state.runner, app.state.store = (
        settings,
        db_factory,
        runner,
        store,
    )

    def db_dep():
        with db_factory() as db:
            yield db

    def authenticated(request: Request, db=Depends(db_dep)):
        raw = request.cookies.get("sqlplat_session", "")
        session = db.get(LoginSession, digest(raw)) if raw else None
        user = db.get(User, session.user_id) if session else None
        if not session or session.expires_at < utcnow() or not user or not user.enabled:
            raise HTTPException(401, "请重新登录")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if not secrets.compare_digest(
                request.headers.get("X-CSRF-Token", ""), session.csrf
            ):
                raise HTTPException(403, "会话校验失败，请刷新页面")
        request.state.session = session
        return user

    register_saved_queries(app, authenticated, db_dep)

    def administrator(user=Depends(authenticated)):
        if user.role != "admin":
            raise HTTPException(403, "需要管理员权限")
        return user

    def owned(task_id, user, db):
        task = db.get(Execution, task_id)
        if not task or task.user_id != user.id:
            raise HTTPException(404, "执行记录不存在")
        return task

    def enabled_connection(cid, db, lock=False):
        query = select(Connection).where(Connection.id == cid)
        conn = db.scalar(query.with_for_update() if lock else query)
        if not conn or conn.deleted:
            raise HTTPException(404, "连接不存在")
        if not conn.enabled:
            raise HTTPException(409, "连接已禁用")
        return conn

    @app.get("/api/health")
    def health():
        with db_factory() as db:
            db.execute(select(1))
        return {"status": "ok"}

    @app.post("/api/auth/login")
    def login(data: Login, response: Response, request: Request, db=Depends(db_dep)):
        # Limit login attempts per IP with a bounded, in-process window.
        import time

        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with login_lock:
            for key in list(login_attempts):
                login_attempts[key] = [t for t in login_attempts[key] if t > now - 60]
                if not login_attempts[key]:
                    del login_attempts[key]
            recent = login_attempts.setdefault(ip, [])
            if len(recent) >= 20 or len(login_attempts) > 10000:
                raise HTTPException(429, "登录尝试过多，请稍后重试")
            recent.append(now)
        user = db.scalar(select(User).where(User.username == data.username))
        if (
            not user
            or not verify_password(user.password_hash, data.password)
            or not user.enabled
        ):
            raise HTTPException(401, "账号或密码错误，或账号已禁用")
        raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        old = request.cookies.get("sqlplat_session")
        if old:
            db.execute(delete(LoginSession).where(LoginSession.token == digest(old)))
        db.add(
            LoginSession(
                token=digest(raw),
                user_id=user.id,
                csrf=csrf,
                expires_at=utcnow() + timedelta(hours=settings.session_hours),
            )
        )
        db.commit()
        response.set_cookie(
            "sqlplat_session",
            raw,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="strict",
            max_age=settings.session_hours * 3600,
            path="/",
        )
        return {"user": user_public(user), "csrf_token": csrf}

    import threading

    login_attempts, login_lock = {}, threading.Lock()

    @app.get("/api/auth/me")
    def me(request: Request, user=Depends(authenticated)):
        return {"user": user_public(user), "csrf_token": request.state.session.csrf}

    @app.post("/api/auth/logout")
    def logout(
        response: Response,
        request: Request,
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        db.delete(request.state.session)
        db.commit()
        response.delete_cookie("sqlplat_session", path="/")
        return {"ok": True}

    @app.post("/api/auth/password")
    def password(
        data: PasswordChange,
        response: Response,
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        if not verify_password(user.password_hash, data.old_password):
            raise HTTPException(400, "原密码错误")
        user.password_hash = hash_password(data.new_password)
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        db.commit()
        response.delete_cookie("sqlplat_session", path="/")
        return {"ok": True}

    @app.get("/api/users")
    def users(user=Depends(administrator), db=Depends(db_dep)):
        return [user_public(u) for u in db.scalars(select(User).order_by(User.id))]

    @app.post("/api/users", status_code=201)
    def user_create(data: UserCreate, user=Depends(administrator), db=Depends(db_dep)):
        item = User(
            username=data.username,
            password_hash=hash_password(data.password),
            role=data.role,
        )
        db.add(item)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "用户名已存在")
        return user_public(item)

    @app.patch("/api/users/{uid}")
    def user_patch(
        uid: int, data: UserPatch, user=Depends(administrator), db=Depends(db_dep)
    ):
        item = db.get(User, uid)
        if not item:
            raise HTTPException(404, "用户不存在")
        if uid == user.id and (data.enabled is False or data.role == "user"):
            raise HTTPException(409, "不能禁用自己或移除自己的管理员权限")
        values = data.model_dump(exclude_none=True)
        if "password" in values:
            item.password_hash = hash_password(values.pop("password"))
            db.execute(delete(LoginSession).where(LoginSession.user_id == uid))
        for k, v in values.items():
            setattr(item, k, v)
        if data.enabled is False:
            db.execute(delete(LoginSession).where(LoginSession.user_id == uid))
        db.commit()
        return user_public(item)

    @app.get("/api/connections")
    def connections(user=Depends(authenticated), db=Depends(db_dep)):
        query = (
            select(Connection)
            .where(Connection.deleted.is_(False))
            .order_by(Connection.id)
        )
        if user.role != "admin":
            query = query.where(Connection.enabled.is_(True))
        return [connection_public(c, user.role == "admin") for c in db.scalars(query)]

    def save_connection(item, data, db):
        values = data.model_dump(exclude={"password"})
        for k, v in values.items():
            setattr(item, k, v)
        if data.password is not None:
            item.password_cipher = (
                settings.crypto().encrypt(data.password.encode()).decode()
            )
        db.add(item)
        db.commit()
        return connection_public(item, True)

    @app.post("/api/connections", status_code=201)
    def connection_create(
        data: ConnectionInput, user=Depends(administrator), db=Depends(db_dep)
    ):
        if data.password is None:
            raise HTTPException(422, "新建连接需要提供密码（可为空字符串）")
        return save_connection(Connection(), data, db)

    @app.put("/api/connections/{cid}")
    def connection_update(
        cid: int, data: ConnectionInput, user=Depends(administrator), db=Depends(db_dep)
    ):
        item = db.scalar(
            select(Connection).where(Connection.id == cid).with_for_update()
        )
        if not item or item.deleted:
            raise HTTPException(404, "连接不存在")
        return save_connection(item, data, db)

    @app.delete("/api/connections/{cid}", status_code=204)
    def connection_delete(cid: int, user=Depends(administrator), db=Depends(db_dep)):
        # Lock the same row as task creation so deletion cannot race a new task.
        item = db.scalar(
            select(Connection).where(Connection.id == cid).with_for_update()
        )
        if not item or item.deleted:
            raise HTTPException(404, "连接不存在")
        unfinished = db.scalar(
            select(Execution.id)
            .where(
                Execution.connection_id == cid,
                Execution.status.in_(["queued", "running"]),
            )
            .limit(1)
            .with_for_update()
        )
        if unfinished:
            raise HTTPException(409, "连接有排队或正在执行的任务，请等待任务结束后删除")
        item.deleted, item.enabled = True, False
        item.password_cipher, item.username, item.host = "", "", ""
        item.tls, item.database = {}, ""
        db.commit()
        return Response(status_code=204)

    def target_call(conn, sql, database=None):
        try:
            secret = settings.crypto().decrypt(conn.password_cipher.encode()).decode()
            with connect_target(snapshot(conn), secret, 10, database) as target:
                with target.cursor() as cur:
                    cur.execute(sql)
                    names = [d[0] for d in cur.description] if cur.description else []
                    rows = cur.fetchall()
                    return names, rows
        except Exception:
            raise HTTPException(
                400, "数据库连接或元数据查询失败，请检查地址、凭据、TLS 和数据库权限"
            )

    @app.post("/api/connections/{cid}/test")
    def connection_test(cid: int, user=Depends(administrator), db=Depends(db_dep)):
        conn = db.get(Connection, cid)
        if not conn or conn.deleted:
            raise HTTPException(404, "连接不存在")
        target_call(conn, "SELECT 1")
        return {"ok": True}

    @app.get("/api/connections/{cid}/databases")
    def databases(cid: int, user=Depends(authenticated), db=Depends(db_dep)):
        _, rows = target_call(enabled_connection(cid, db), "SHOW DATABASES")
        return [row[0] for row in rows]

    @app.get("/api/connections/{cid}/tables")
    def tables(
        cid: int,
        database: str = Query(min_length=1, max_length=128),
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        _, rows = target_call(
            enabled_connection(cid, db), "SHOW TABLES FROM " + identifier(database)
        )
        return [row[0] for row in rows]

    @app.get("/api/connections/{cid}/columns")
    def columns(
        cid: int,
        database: str,
        table: str,
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        names, rows = target_call(
            enabled_connection(cid, db),
            "SHOW FULL COLUMNS FROM " + identifier(database) + "." + identifier(table),
        )
        return [dict(zip(names, row)) for row in rows]

    def task_json(task, db, detail=True):
        value = {
            k: getattr(task, k)
            for k in (
                "id",
                "connection_id",
                "connection_name",
                "database",
                "sql",
                "status",
                "created_at",
                "started_at",
                "ended_at",
                "error",
                "elapsed_ms",
            )
        }
        connection = db.get(Connection, task.connection_id)
        if not connection or connection.deleted:
            value["connection_id"] = None
        if detail:
            value["statements"] = [
                {
                    k: getattr(s, k)
                    for k in (
                        "id",
                        "ordinal",
                        "sql",
                        "status",
                        "columns",
                        "affected_rows",
                        "saved_rows",
                        "truncated",
                        "expires_at",
                        "elapsed_ms",
                        "error",
                    )
                }
                for s in db.scalars(
                    select(Statement)
                    .where(Statement.execution_id == task.id)
                    .order_by(Statement.ordinal)
                )
            ]
        return value

    @app.post("/api/executions", status_code=202)
    def execute(data: ExecutionInput, user=Depends(authenticated), db=Depends(db_dep)):
        try:
            validate_sql(data.sql)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        conn = enabled_connection(data.connection_id, db, lock=True)
        if not runner.pool.acquire():
            raise HTTPException(429, "执行队列已满，请稍后重试")
        try:
            task = Execution(
                user_id=user.id,
                connection_id=conn.id,
                connection_name=conn.name,
                database=data.database or conn.database,
                sql=data.sql,
            )
            db.add(task)
            db.commit()
        except BaseException:
            runner.pool.release()
            raise
        try:
            runner.pool.submit(
                runner.run, task.id, snapshot(conn), conn.password_cipher
            )
        except Exception:
            task.status, task.ended_at, task.error = (
                "interrupted",
                utcnow(),
                "任务提交失败，未自动重试",
            )
            db.commit()
            raise HTTPException(503, "任务执行器不可用")
        return {"id": task.id, "status": "queued"}

    @app.get("/api/executions")
    def history(
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        status: Optional[str] = None,
        q: str = "",
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        query = select(Execution).where(Execution.user_id == user.id)
        if status:
            query = query.where(Execution.status == status)
        if q:
            query = query.where(Execution.sql.contains(q, autoescape=True))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        tasks = db.scalars(
            query.order_by(Execution.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {"items": [task_json(t, db, False) for t in tasks], "total": total}

    @app.get("/api/executions/{eid}")
    def execution(eid: str, user=Depends(authenticated), db=Depends(db_dep)):
        return task_json(owned(eid, user, db), db)

    def result_statement(eid, sid, user, db):
        task = owned(eid, user, db)
        statement = db.get(Statement, sid)
        if not statement or statement.execution_id != task.id:
            raise HTTPException(404, "结果不存在")
        if task.status in ("queued", "running"):
            raise HTTPException(409, "任务尚未结束，请稍后查看")
        if not statement.columns:
            raise HTTPException(409, "该语句没有结果集")
        if (
            not statement.expires_at
            or statement.expires_at < utcnow()
            or not statement.file_name
            or not store.path(statement.file_name).exists()
        ):
            raise HTTPException(410, "结果已过期，执行历史仍可查看")
        return statement

    @app.get("/api/executions/{eid}/results/{sid}")
    def result(
        eid: str,
        sid: int,
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=1000),
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        st = result_statement(eid, sid, user, db)
        available = min(st.saved_rows, settings.preview_rows)
        try:
            rows = store.page(
                st.file_name,
                min(offset, available),
                max(0, min(limit, available - offset)),
            )
        except FileNotFoundError:
            raise HTTPException(410, "结果已过期")
        return {
            "columns": st.columns,
            "rows": rows,
            "total": available,
            "saved_rows": st.saved_rows,
            "truncated": st.truncated,
        }

    @app.get("/api/executions/{eid}/results/{sid}/download")
    def download(
        eid: str,
        sid: int,
        format: str = Query("csv", pattern="^(csv|xlsx)$"),
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        st = result_statement(eid, sid, user, db)
        # Hold the lease until the response generator finishes (including disconnect).
        lease = store.lease(st.file_name)
        try:
            lease.__enter__()
        except FileNotFoundError:
            raise HTTPException(410, "结果已过期")
        file = None
        try:
            if format == "xlsx":
                file = store.xlsx_file(st.file_name, st.columns)
        except BaseException:
            lease.__exit__(None, None, None)
            raise
        released = False
        release_lock = threading.Lock()

        def release():
            nonlocal released
            with release_lock:
                if released:
                    return
                released = True
                if file:
                    file.close()
                lease.__exit__(None, None, None)

        def chunks():
            try:
                if file:
                    while True:
                        chunk = file.read(65536)
                        if not chunk:
                            break
                        yield chunk
                else:
                    yield from store.csv_chunks(st.file_name, st.columns)
            finally:
                release()

        media = (
            "text/csv; charset=utf-8"
            if format == "csv"
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        return LeasedStreamingResponse(
            chunks(),
            cleanup=release,
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="result-{sid}.{format}"',
                "X-Result-Truncated": str(st.truncated).lower(),
            },
        )

    return app
