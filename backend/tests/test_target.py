import ssl


def test_tls_uses_verified_context_even_without_custom_ca(monkeypatch):
    from app.target import connect_target

    captured = {}

    def capture(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("app.target.pymysql.connect", capture)
    connect_target(
        {"host": "localhost", "port": 3306, "username": "u", "tls": {"enabled": True}},
        "p",
        10,
    )
    assert isinstance(captured["ssl"], ssl.SSLContext)
    assert captured["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert captured["ssl"].check_hostname
    assert captured["local_infile"] is False


def test_postgresql_connection_parameters(monkeypatch):
    from app.target import connect_target
    captured = {}
    monkeypatch.setattr('app.target.psycopg.connect', lambda **kw: captured.update(kw))
    connect_target({'kind': 'postgresql', 'host': 'db', 'port': 5432,
                    'username': 'reader', 'database': 'configured',
                    'tls': {'enabled': True, 'ca': '/ca.pem'}}, 'secret', 12, 'chosen')
    assert captured['dbname'] == 'chosen'
    assert captured['sslmode'] == 'verify-full'
    assert captured['sslrootcert'] == '/ca.pem'
    assert captured['autocommit'] is True
    assert captured['options'] == '-c statement_timeout=12000'
    assert captured['connect_timeout'] == 10


def test_postgresql_default_database_and_tls(monkeypatch):
    from app.target import connect_target
    captured = {}
    monkeypatch.setattr('app.target.psycopg.connect', lambda **kw: captured.update(kw))
    connect_target({'kind': 'postgresql', 'host': 'db', 'port': 5432,
                    'username': 'reader'}, '', 10)
    assert captured['dbname'] == 'postgres'
    assert captured['sslmode'] == 'disable'
