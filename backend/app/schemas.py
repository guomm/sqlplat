from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .accounts import normalize_account


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Input):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("username", mode="before")
    @classmethod
    def trim_username(cls, value):
        return value.strip() if isinstance(value, str) else value


class PasswordChange(Input):
    old_password: str
    new_password: str = Field(min_length=8, max_length=1024)


class UserCreate(Input):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=1024)
    role: Literal["admin", "user"] = "user"

    @field_validator("username", mode="before")
    @classmethod
    def validate_username(cls, value):
        return normalize_account(value) if isinstance(value, str) else value


class UserPatch(Input):
    enabled: Optional[bool] = None
    role: Optional[Literal["admin", "user"]] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=1024)


class TLS(Input):
    enabled: bool = False
    ca: str = ""
    cert: str = ""
    key: str = ""


class ConnectionInput(Input):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["mysql", "doris"]
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    username: str = Field(min_length=1, max_length=128)
    password: Optional[str] = Field(default=None, max_length=4096)
    database: str = Field(default="", max_length=128)
    enabled: bool = True
    tls: TLS = Field(default_factory=TLS)


class ExecutionInput(Input):
    connection_id: int
    database: str = Field(default="", max_length=128)
    sql: str = Field(min_length=1, max_length=1000000)


class SavedQueryName(Input):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class SavedQueryInput(SavedQueryName):
    sql: str = Field(min_length=1, max_length=1000000)
    connection_id: int | None = None
    database: str = Field(default="", max_length=128)

    @field_validator("sql")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("SQL 不能为空")
        return value
