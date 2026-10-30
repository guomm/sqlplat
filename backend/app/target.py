import ssl

import pymysql
import psycopg


def connect_target(config, password, timeout, database=None):
    tls = config.get("tls", {})
    if config.get("kind") == "postgresql":
        return psycopg.connect(
            host=config["host"], port=config["port"], user=config["username"],
            password=password, dbname=database or config.get("database") or "postgres",
            autocommit=True, connect_timeout=min(timeout, 10),
            client_encoding="UTF8",
            options=f"-c statement_timeout={int(timeout * 1000)}",
            sslmode="verify-full" if tls.get("enabled") else "disable",
            **{key: tls[field] for key, field in (
                ("sslrootcert", "ca"), ("sslcert", "cert"), ("sslkey", "key")
            ) if tls.get("enabled") and tls.get(field)},
        )
    kwargs = {}
    if tls.get("enabled"):
        context = ssl.create_default_context(cafile=tls.get("ca") or None)
        if tls.get("cert"):
            context.load_cert_chain(tls["cert"], tls.get("key") or None)
        kwargs["ssl"] = context
    return pymysql.connect(
        host=config["host"],
        port=config["port"],
        user=config["username"],
        password=password,
        database=database or config.get("database") or None,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.SSCursor,
        connect_timeout=min(timeout, 10),
        read_timeout=timeout,
        write_timeout=timeout,
        local_infile=False,
        **kwargs,
    )


def identifier(value):
    return "`" + value.replace("`", "``") + "`"
