"""Private file storage: local disk, or Supabase Storage when configured.

Files are never given a public URL. The API serves them only after an
authenticated, authorized request.
"""
from __future__ import annotations

import urllib.error
import urllib.request
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import Response

from .config import get_settings


def cloud_configured() -> bool:
    s = get_settings()
    return bool(s.supabase_url and s.supabase_service_role_key)


def put(rel_path: str, data: bytes) -> str:
    """Save bytes and return the storage key stored on the submission/excuse/BP row."""
    s = get_settings()
    if cloud_configured():
        bucket = s.supabase_storage_bucket or "plare-uploads"
        url = f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{rel_path}"
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Authorization": f"Bearer {s.supabase_service_role_key}",
            "Content-Type": "application/octet-stream",
            "x-upsert": "true",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp.read()
        except urllib.error.URLError as exc:
            raise HTTPException(503, "Couldn't save the file to cloud storage. Try again.") from exc
        return f"supabase:{rel_path}"
    path = Path(s.upload_dir) / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel_path


def read(file_path: str) -> bytes:
    if not file_path:
        raise HTTPException(404, "File not found")
    s = get_settings()
    if file_path.startswith("supabase:"):
        if not cloud_configured():
            raise HTTPException(503, "Cloud storage isn't configured on this server.")
        key = file_path.removeprefix("supabase:")
        bucket = s.supabase_storage_bucket or "plare-uploads"
        url = f"{s.supabase_url.rstrip('/')}/storage/v1/object/authenticated/{bucket}/{key}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {s.supabase_service_role_key}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise HTTPException(404, "File not found") from exc
            raise HTTPException(503, "Couldn't load the file from cloud storage. Try again.") from exc
        except urllib.error.URLError as exc:
            raise HTTPException(503, "Couldn't load the file from cloud storage. Try again.") from exc
    path = Path(s.upload_dir) / file_path
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return path.read_bytes()


def file_response(file_path: str, media_type: str | None = None) -> Response:
    data = read(file_path)
    return Response(
        content=data,
        media_type=media_type or "application/octet-stream",
        headers={"Cache-Control": "private, no-store"},
    )


def remove(file_path: str) -> None:
    if not file_path:
        return
    s = get_settings()
    if file_path.startswith("supabase:"):
        if not cloud_configured():
            return
        key = file_path.removeprefix("supabase:")
        bucket = s.supabase_storage_bucket or "plare-uploads"
        url = f"{s.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{key}"
        req = urllib.request.Request(url, method="DELETE", headers={
            "Authorization": f"Bearer {s.supabase_service_role_key}",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp.read()
        except urllib.error.URLError:
            pass
        return
    path = Path(s.upload_dir) / file_path
    path.unlink(missing_ok=True)
