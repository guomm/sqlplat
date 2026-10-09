import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.mysql import DATETIME, LONGTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id():
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), default=utcnow
    )


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    csrf: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql")
    )


class Connection(Base):
    __tablename__ = "connections"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(16))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    username: Mapped[str] = mapped_column(String(128))
    password_cipher: Mapped[str] = mapped_column(Text)
    database: Mapped[str] = mapped_column(String(128), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    tls: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Execution(Base):
    __tablename__ = "executions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    connection_id: Mapped[int] = mapped_column(ForeignKey("connections.id"))
    connection_name: Mapped[str] = mapped_column(String(100))
    database: Mapped[str] = mapped_column(String(128), default="")
    sql: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"))
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), default=utcnow, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=True
    )
    ended_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=True
    )
    error: Mapped[str] = mapped_column(Text, default="")
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)


class Statement(Base):
    __tablename__ = "statements"
    id: Mapped[int] = mapped_column(primary_key=True)
    execution_id: Mapped[str] = mapped_column(ForeignKey("executions.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    sql: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"))
    status: Mapped[str] = mapped_column(String(16), default="running")
    columns: Mapped[list] = mapped_column(JSON, default=list)
    affected_rows: Mapped[int] = mapped_column(Integer, default=0)
    saved_rows: Mapped[int] = mapped_column(Integer, default=0)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    file_name: Mapped[str] = mapped_column(String(80), default="")
    expires_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=True
    )
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")


class SavedQuery(Base):
    __tablename__ = "saved_queries"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(100))
    sql: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"))
    connection_id: Mapped[int | None] = mapped_column(
        ForeignKey("connections.id"), nullable=True
    )
    database: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime().with_variant(DATETIME(fsp=6), "mysql"), default=utcnow
    )
    __table_args__ = (Index("ix_saved_queries_user_updated", "user_id", "updated_at"),)
