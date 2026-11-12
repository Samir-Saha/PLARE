from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app import storage
from app.config import get_settings


def test_local_put_read_and_remove(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    get_settings.cache_clear()
    try:
        key = storage.put("org/file.png", b"\x89PNG\r\n\x1a\nhello")
        assert key == "org/file.png"
        assert storage.read(key).endswith(b"hello")
        resp = storage.file_response(key, "image/png")
        assert resp.headers["Cache-Control"] == "private, no-store"
        assert resp.media_type == "image/png"
        storage.remove(key)
        with pytest.raises(HTTPException) as exc:
            storage.read(key)
        assert exc.value.status_code == 404
    finally:
        get_settings.cache_clear()


def test_cloud_put_uses_service_role_and_stores_a_private_key(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret")
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "plare-uploads")
    get_settings.cache_clear()
    captured = {}

    class FakeResp:
        def read(self):
            return b"{}"
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False

    def fake_urlopen(req, timeout=30):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["auth"] = req.headers.get("Authorization")
        captured["upsert"] = req.headers.get("X-upsert") or req.headers.get("x-upsert")
        return FakeResp()

    try:
        with patch("app.storage.urllib.request.urlopen", fake_urlopen):
            key = storage.put("org/secret.jpg", b"bytes")
        assert key == "supabase:org/secret.jpg"
        assert "object/plare-uploads/org/secret.jpg" in captured["url"]
        assert captured["auth"] == "Bearer service-role-secret"
        assert "public" not in captured["url"]
    finally:
        get_settings.cache_clear()
