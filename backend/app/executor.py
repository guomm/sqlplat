import json
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pymysql
from sqlalchemy import delete, select, update

from .models import Execution, LoginSession, Statement, utcnow
from .results import serialize
from .sql import validate_sql
from .target import connect_target


class BoundedPool:
    def __init__(self, workers, queued):
        self.capacity = threading.BoundedSemaphore(workers + queued)
        self.executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="sql"
        )

    def acquire(self):
        return self.capacity.acquire(blocking=False)

    def release(self):
        self.capacity.release()

    def submit(self, fn, *args):
        def run():
            try:
                fn(*args)
            finally:
                self.release()

        try:
            return self.executor.submit(run)
        except BaseException:
            self.release()
            raise

    def shutdown(self):
        self.executor.shutdown(wait=True)


def abort_connection(connection):
    # A socket shutdown interrupts a blocked receive; Future.cancel does not.
    sock = getattr(connection, "_sock", None)
    if sock:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass


class Executor:
    def __init__(self, settings, db, store):
        self.settings, self.db, self.store = settings, db, store
        self.pool = BoundedPool(settings.execution_workers, settings.execution_queue)

    def recover(self):
        with self.db() as db:
            now = utcnow()
            interrupted = select(Execution.id).where(
                Execution.status.in_(["queued", "running"])
            )
            db.execute(
                update(Statement)
                .where(
                    Statement.execution_id.in_(interrupted),
                    Statement.status == "running",
                )
                .values(status="interrupted", error="服务重启，执行状态需核实")
            )
            db.execute(
                update(Execution)
                .where(Execution.status.in_(["queued", "running"]))
                .values(
                    status="interrupted",
                    ended_at=now,
                    error="服务重启，任务已中断；写入可能已生效，请核实，不会自动重试",
                )
            )
            db.commit()

    def clean(self):
        with self.db() as db:
            terminal = select(Execution.id).where(
                Execution.status.not_in(["queued", "running"])
            )
            expired = db.scalars(
                select(Statement).where(
                    Statement.execution_id.in_(terminal),
                    Statement.expires_at < utcnow(),
                    Statement.file_name != "",
                )
            ).all()
            for statement in expired:
                if self.store.delete(statement.file_name):
                    statement.file_name = ""
            cutoff = utcnow() - timedelta(days=self.settings.history_days)
            old = db.scalars(
                select(Execution).where(
                    Execution.created_at < cutoff,
                    Execution.status.not_in(["queued", "running"]),
                )
            ).all()
            for task in old:
                statements = db.scalars(
                    select(Statement).where(Statement.execution_id == task.id)
                ).all()
                if all(
                    not st.file_name or self.store.delete(st.file_name)
                    for st in statements
                ):
                    db.execute(
                        delete(Statement).where(Statement.execution_id == task.id)
                    )
                    db.delete(task)
            db.execute(delete(LoginSession).where(LoginSession.expires_at < utcnow()))
            db.commit()
        # Remove files orphaned by an interrupted process only after their retention period.
        with self.db() as db:
            active_files = set(
                db.scalars(
                    select(Statement.file_name).where(Statement.file_name != "")
                ).all()
            )
        cutoff = time.time() - self.settings.result_hours * 3600
        for path in self.store.root.glob("*.jsonl"):
            if path.name not in active_files and path.stat().st_mtime < cutoff:
                self.store.delete(path.name)

    def run(self, task_id, config, encrypted_password):
        connection = None
        timer = None
        timed_out = threading.Event()
        start = time.monotonic()
        current = None
        size = 0
        with self.db() as db:
            task = db.get(Execution, task_id)
            task.status = "running"
            task.started_at = utcnow()
            db.commit()
            try:
                password = (
                    self.settings.crypto().decrypt(encrypted_password.encode()).decode()
                )
                connection = connect_target(
                    config, password, self.settings.execution_timeout, task.database
                )

                def timeout():
                    timed_out.set()
                    abort_connection(connection)

                deadline = start + self.settings.execution_timeout
                timer = threading.Timer(max(0, deadline - time.monotonic()), timeout)
                timer.daemon = True
                timer.start()
                with connection.cursor() as setup:
                    if config["kind"] == "doris":
                        setup.execute(
                            "SET query_timeout = %s", (self.settings.execution_timeout,)
                        )
                    else:
                        setup.execute(
                            "SET SESSION max_execution_time = %s",
                            (self.settings.execution_timeout * 1000,),
                        )
                for ordinal, part in enumerate(validate_sql(task.sql)):
                    if timed_out.is_set() or time.monotonic() >= deadline:
                        raise TimeoutError()
                    current = Statement(
                        execution_id=task.id, ordinal=ordinal, sql=part["sql"]
                    )
                    db.add(current)
                    db.commit()
                    statement_start = time.monotonic()
                    cursor = connection.cursor()
                    try:
                        cursor.execute(part["sql"])
                        if cursor.description:
                            current.columns = [
                                {"name": col[0], "type": col[1]}
                                for col in cursor.description
                            ]
                            current.file_name = uuid.uuid4().hex + ".jsonl"
                            current.expires_at = utcnow() + timedelta(
                                hours=self.settings.result_hours
                            )
                            db.commit()
                            with self.store.path(current.file_name).open(
                                "w", encoding="utf-8"
                            ) as out:
                                while True:
                                    rows = cursor.fetchmany(500)
                                    if not rows:
                                        break
                                    for row in rows:
                                        if (
                                            timed_out.is_set()
                                            or time.monotonic() >= deadline
                                        ):
                                            raise TimeoutError()
                                        if (
                                            current.saved_rows
                                            >= self.settings.result_rows
                                        ):
                                            current.truncated = True
                                            continue
                                        line = (
                                            json.dumps(
                                                [serialize(v) for v in row],
                                                ensure_ascii=False,
                                            )
                                            + "\n"
                                        )
                                        byte_count = len(line.encode("utf-8"))
                                        if (
                                            size + byte_count
                                            > self.settings.result_bytes
                                        ):
                                            current.truncated = True
                                            raise OverflowError(
                                                "结果文件达到容量上限，后续语句未执行；写入状态需核实"
                                            )
                                        out.write(line)
                                        size += byte_count
                                        current.saved_rows += 1
                        else:
                            current.affected_rows = max(0, cursor.rowcount)
                        # Consume any additional protocol results without rerunning SQL.
                        while cursor.nextset():
                            while cursor.fetchmany(500):
                                if timed_out.is_set():
                                    raise TimeoutError()
                        current.status = "success"
                    except BaseException:
                        abort_connection(connection)
                        raise
                    else:
                        cursor.close()
                    current.elapsed_ms = int(
                        (time.monotonic() - statement_start) * 1000
                    )
                    db.commit()
                if timed_out.is_set():
                    raise TimeoutError()
                task.status = "success"
            except Exception as exc:
                uncertain = (
                    timed_out.is_set()
                    or isinstance(exc, (TimeoutError, OverflowError, OSError))
                    or (
                        isinstance(exc, pymysql.OperationalError)
                        and exc.args[0] in (2006, 2013, 1317, 3024)
                    )
                )
                if isinstance(exc, pymysql.MySQLError) and any(
                    marker in str(exc).lower()
                    for marker in (
                        "query timeout",
                        "query timed out",
                        "execution timeout",
                    )
                ):
                    uncertain = True
                task.status = "interrupted" if uncertain else "failed"
                if timed_out.is_set() or isinstance(exc, TimeoutError):
                    message = "任务超时，已停止后续语句；数据库端写入可能已生效，请核实"
                else:
                    message = str(exc)[:3000]
                    if encrypted_password:
                        try:
                            secret = (
                                self.settings.crypto()
                                .decrypt(encrypted_password.encode())
                                .decode()
                            )
                            if secret:
                                message = message.replace(secret, "***")
                        except Exception:
                            pass
                    if uncertain:
                        message += "；写入可能已生效，请核实，不会自动重试"
                task.error = message
                if current and current.status == "running":
                    current.status = task.status
                    current.error = message
                    current.elapsed_ms = int(
                        (time.monotonic() - statement_start) * 1000
                    )
            finally:
                if timer:
                    timer.cancel()
                if connection:
                    abort_connection(connection)
                    try:
                        connection.close()
                    except Exception:
                        pass
                task.ended_at = utcnow()
                task.elapsed_ms = int((time.monotonic() - start) * 1000)
                db.commit()
