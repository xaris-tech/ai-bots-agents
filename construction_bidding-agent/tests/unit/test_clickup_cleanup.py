import ssl

import certifi

from app.clickup_cleanup import _clickup_ssl_context


def test_clickup_ssl_context_uses_packaged_ca_bundle(monkeypatch) -> None:
    captured: dict[str, str] = {}
    expected = ssl.create_default_context()

    def fake_create_default_context(*, cafile: str) -> ssl.SSLContext:
        captured["cafile"] = cafile
        return expected

    monkeypatch.setattr(ssl, "create_default_context", fake_create_default_context)

    result = _clickup_ssl_context()

    assert result is expected
    assert captured["cafile"] == certifi.where()
