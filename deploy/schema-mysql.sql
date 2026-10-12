-- SQL Atelier 首版平台建表快照，MySQL 8.0+
-- 生成日期：2026-10-10；迁移版本：d19297a3c813
-- 仅用于已经创建的空 sqlplat 库，不是已有库的升级或修复脚本。
-- 应用代码负责填写默认值、时间、密码哈希与加密后的连接密码。
-- 完整执行，不要使用 mysql --force 跳过错误；迁移版本在最后写入。
USE sqlplat;

CREATE TABLE connections (
    id INTEGER NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    username VARCHAR(128) NOT NULL,
    password_cipher TEXT NOT NULL,
    `database` VARCHAR(128) NOT NULL,
    enabled BOOL NOT NULL,
    tls JSON NOT NULL,
    deleted BOOL NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
    id INTEGER NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    enabled BOOL NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE executions (
    id VARCHAR(32) NOT NULL,
    user_id INTEGER NOT NULL,
    connection_id INTEGER NOT NULL,
    connection_name VARCHAR(100) NOT NULL,
    `database` VARCHAR(128) NOT NULL,
    `sql` LONGTEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    started_at DATETIME(6),
    ended_at DATETIME(6),
    error TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    FOREIGN KEY(connection_id) REFERENCES connections (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX ix_executions_created_at ON executions (created_at);

CREATE INDEX ix_executions_status ON executions (status);

CREATE INDEX ix_executions_user_id ON executions (user_id);

CREATE TABLE login_sessions (
    token VARCHAR(64) NOT NULL,
    user_id INTEGER NOT NULL,
    csrf VARCHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (token),
    FOREIGN KEY(user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX ix_login_sessions_user_id ON login_sessions (user_id);

CREATE TABLE saved_queries (
    id VARCHAR(32) NOT NULL,
    user_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    `sql` LONGTEXT NOT NULL,
    connection_id INTEGER,
    `database` VARCHAR(128) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    FOREIGN KEY(connection_id) REFERENCES connections (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX ix_saved_queries_user_updated ON saved_queries (user_id, updated_at);

CREATE TABLE statements (
    id INTEGER NOT NULL AUTO_INCREMENT,
    execution_id VARCHAR(32) NOT NULL,
    ordinal INTEGER NOT NULL,
    `sql` LONGTEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    columns JSON NOT NULL,
    affected_rows INTEGER NOT NULL,
    saved_rows INTEGER NOT NULL,
    truncated BOOL NOT NULL,
    file_name VARCHAR(80) NOT NULL,
    expires_at DATETIME(6),
    elapsed_ms INTEGER NOT NULL,
    error TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(execution_id) REFERENCES executions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX ix_statements_execution_id ON statements (execution_id);

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pk PRIMARY KEY (version_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO alembic_version (version_num) VALUES ('d19297a3c813');
