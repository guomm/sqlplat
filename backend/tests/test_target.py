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
