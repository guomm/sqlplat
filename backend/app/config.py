from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = (
        "mysql+pymysql://sqlplat:sqlplat@mysql:3306/sqlplat?charset=utf8mb4"
    )
    encryption_key: str
    result_dir: Path = Path("/data/results")
    execution_workers: int = Field(default=4, ge=1, le=64)
    execution_queue: int = Field(default=20, ge=0, le=1000)
    execution_timeout: int = Field(default=300, ge=1)
    result_rows: int = Field(default=100000, ge=1)
    preview_rows: int = Field(default=1000, ge=1)
    result_bytes: int = Field(default=100 * 1024 * 1024, ge=1)
    result_hours: int = Field(default=24, ge=1)
    history_days: int = Field(default=90, ge=1)
    session_hours: int = Field(default=12, ge=1)
    cookie_secure: bool = True

    def crypto(self):
        return Fernet(self.encryption_key.encode())
