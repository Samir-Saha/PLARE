"""BP checker (camera-only photos) and the AI-writing check."""
from datetime import timedelta

import httpx
import pytest

from app import ai_check
from app.config import get_settings
from app.db import SessionLocal
from app.models import CaptureToken, LogEntry

from .conftest import as_user
from .test_api import PNG, make_task, mine

LONG = "This is a paragraph I wrote about what I built this week and what I learned from it. " * 5


def _pdf(text: str) -> bytes:
    """A minimal one-page PDF whose page draws `text`."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)


@pytest.fixture
def gptzero(monkeypatch):
    """Turn the AI check on with a fake detector. Returns the list of texts it was sent."""
    monkeypatch.setattr(get_settings(), "gptzero_api_key", "test-key")
    sent: list[str] = []

    def fake(text, key):
        sent.append(text)
        return 0.91, "ai"

    monkeypatch.setattr(ai_check, "detect", fake)
    return sent


def queue(client, world):
    return client.get(f"/orgs/{world['org_a']}/review", headers=as_user("lead@t.demo")).json()


# --- BP checker: camera-only photos -------------------------------------------------------

def test_camera_task_rejects_uploaded_files(client, world):
    make_task(client, world, evidence="camera")
    a = mine(client, world)[0]
    h = as_user("m1@t.demo")
    r = client.post(f"/assignments/{a['id']}/submissions", files={"file": ("x.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 422
    assert "camera" in r.json()["detail"]
    bogus = client.post(f"/assignments/{a['id']}/submissions", data={"capture_token": "made-up"},
                        files={"file": ("x.png", PNG, "image/png")}, headers=h)
    assert bogus.status_code == 422


def test_camera_capture_flow(client, world):
    make_task(client, world, evidence="camera")
    a = mine(client, world)[0]
    h = as_user("m1@t.demo")
    tok = client.post(f"/assignments/{a['id']}/capture", headers=h)
    assert tok.status_code == 201
    token = tok.json()["token"]
    # Another member can't use it, or ask for one on someone else's assignment.
    assert client.post(f"/assignments/{a['id']}/capture", headers=as_user("m2@t.demo")).status_code == 404
    m2 = mine(client, world, "m2")[0]
    stolen = client.post(f"/assignments/{m2['id']}/submissions", data={"capture_token": token},
                         files={"file": ("x.png", PNG, "image/png")}, headers=as_user("m2@t.demo"))
    assert stolen.status_code == 422
    # A PDF isn't a photo, even with a valid token.
    pdf = client.post(f"/assignments/{a['id']}/submissions", data={"capture_token": token},
                      files={"file": ("x.pdf", b"%PDF-1.4 x", "application/pdf")}, headers=h)
    assert pdf.status_code == 415

    ok = client.post(f"/assignments/{a['id']}/submissions", data={"capture_token": token},
                     files={"file": ("x.png", PNG, "image/png")}, headers=h)
    assert ok.status_code == 201, ok.text
    row = queue(client, world)[0]
    assert row["captured_in_app"] is True and row["captured_at"] and row["evidence"] == "camera"

    # Sent back for a redo: the old token can't be reused.
    client.post(f"/submissions/{row['id']}/review", json={"decision": "needs_revision", "feedback": "Blazer, please"},
                headers=as_user("lead@t.demo"))
    again = client.post(f"/assignments/{a['id']}/submissions", data={"capture_token": token},
                        files={"file": ("x.png", PNG, "image/png")}, headers=h)
    assert again.status_code == 409


def test_camera_token_expires(client, world):
    make_task(client, world, evidence="camera")
    a = mine(client, world)[0]
    h = as_user("m1@t.demo")
    token = client.post(f"/assignments/{a['id']}/capture", headers=h).json()["token"]
    with SessionLocal() as db:
        tok = db.get(CaptureToken, token)
        tok.created_at -= timedelta(minutes=11)
        db.commit()
    r = client.post(f"/assignments/{a['id']}/submissions", data={"capture_token": token},
                    files={"file": ("x.png", PNG, "image/png")}, headers=h)
    assert r.status_code == 422
    assert "10 minutes" in r.json()["detail"]


def test_capture_only_for_camera_tasks(client, world):
    make_task(client, world, evidence="photo")
    a = mine(client, world)[0]
    assert client.post(f"/assignments/{a['id']}/capture", headers=as_user("m1@t.demo")).status_code == 409
    # Ordinary photo tasks still take uploads, and aren't marked as taken in the app.
    client.post(f"/assignments/{a['id']}/submissions", files={"file": ("x.png", PNG, "image/png")}, headers=as_user("m1@t.demo"))
    assert queue(client, world)[0]["captured_in_app"] is False


# --- AI-writing check ---------------------------------------------------------------------

def test_ai_check_not_configured_without_key(client, world):
    make_task(client, world, evidence="text")
    a = mine(client, world)[0]
    assert a["ai_check_on"] is False
    client.post(f"/assignments/{a['id']}/submissions", data={"text": LONG}, headers=as_user("m1@t.demo"))
    row = queue(client, world)[0]
    assert (row["ai_status"], row["ai_score"]) == ("not_configured", None)
    r = client.post(f"/submissions/{row['id']}/ai-check", headers=as_user("lead@t.demo"))
    assert r.status_code == 409 and "GPTZERO_API_KEY" in r.json()["detail"]


def test_ai_score_shown_to_reviewers_and_submitter_only(client, world, gptzero):
    make_task(client, world, evidence="any")
    a = mine(client, world)[0]
    assert a["ai_check_on"] is True
    client.post(f"/assignments/{a['id']}/submissions", data={"text": LONG},
                files={"file": ("slides.pdf", _pdf("Slide one: our capstone architecture"), "application/pdf")},
                headers=as_user("m1@t.demo"))
    # The note and the PDF's text were both checked.
    assert len(gptzero) == 1 and "capstone architecture" in gptzero[0] and "what I built" in gptzero[0]
    row = queue(client, world)[0]
    assert (row["ai_status"], row["ai_score"], row["ai_label"]) == ("done", 0.91, "ai")
    # The submitter sees their own result.
    assert mine(client, world)[0]["check"]["ai_score"] == 0.91
    # A flag never notifies anyone, writes to the log, or changes the submission.
    lead_notes = client.get("/notifications", headers=as_user("lead@t.demo")).json()
    assert all("AI" not in n["title"] for n in lead_notes)
    with SessionLocal() as db:
        assert db.query(LogEntry).count() == 0
    assert row["status"] == "pending"
    # Members and other groups can't see the queue or re-run checks.
    assert client.post(f"/submissions/{row['id']}/ai-check", headers=as_user("m1@t.demo")).status_code == 403
    assert client.post(f"/submissions/{row['id']}/ai-check", headers=as_user("outsider@t.demo")).status_code == 404
    assert client.post(f"/submissions/{row['id']}/ai-check", headers=as_user("lead@t.demo")).status_code == 409


def test_short_text_and_photos_are_not_sent(client, world, gptzero):
    make_task(client, world, evidence="any")
    for who, kwargs in (("m1", {"data": {"text": "Done!"}}), ("m2", {"files": {"file": ("x.png", PNG, "image/png")}})):
        a = mine(client, world, who)[0]
        client.post(f"/assignments/{a['id']}/submissions", headers=as_user(f"{who}@t.demo"), **kwargs)
    statuses = {r["user_name"]: r["ai_status"] for r in queue(client, world)}
    assert statuses == {"m1": "too_short", "m2": "skipped"}
    assert gptzero == []


def test_ai_check_error_can_be_rerun(client, world, monkeypatch):
    monkeypatch.setattr(get_settings(), "gptzero_api_key", "test-key")

    def down(text, key):
        raise ai_check.DetectorError("GPTZero didn't respond. Run the check again.")

    monkeypatch.setattr(ai_check, "detect", down)
    make_task(client, world, evidence="text")
    a = mine(client, world)[0]
    client.post(f"/assignments/{a['id']}/submissions", data={"text": LONG}, headers=as_user("m1@t.demo"))
    row = queue(client, world)[0]
    assert (row["ai_status"], row["ai_error"]) == ("error", "GPTZero didn't respond. Run the check again.")

    monkeypatch.setattr(ai_check, "detect", lambda text, key: (0.04, "human"))
    r = client.post(f"/submissions/{row['id']}/ai-check", headers=as_user("lead@t.demo"))
    assert r.status_code == 200
    row = queue(client, world)[0]
    assert (row["ai_status"], row["ai_score"], row["ai_error"]) == ("done", 0.04, "")


def test_detect_parses_gptzero_and_reports_errors(monkeypatch):
    def respond(status, body):
        return lambda *a, **k: httpx.Response(status, json=body, request=httpx.Request("POST", ai_check.GPTZERO_URL))

    monkeypatch.setattr(httpx, "post", respond(200, {"documents": [
        {"class_probabilities": {"ai": 0.7, "human": 0.2, "mixed": 0.1}, "predicted_class": "ai"}]}))
    assert ai_check.detect("text", "k") == (0.7, "ai")
    monkeypatch.setattr(httpx, "post", respond(200, {"documents": [{"completely_generated_prob": 0.2}]}))
    assert ai_check.detect("text", "k") == (0.2, None)
    for status, words in ((401, "API key"), (429, "limit"), (500, "error"), (200, "couldn't read")):
        monkeypatch.setattr(httpx, "post", respond(status, {} if status == 200 else {"error": "x"}))
        with pytest.raises(ai_check.DetectorError, match=words):
            ai_check.detect("text", "k")
