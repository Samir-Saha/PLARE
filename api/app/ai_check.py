"""AI-writing check for submissions, using GPTZero.

The score is a signal for the reviewer, not a verdict. Detectors misjudge human writing
(especially by non-native English speakers), so the result is only shown in the review
queue and to the person who submitted. It never notifies anyone, never writes to the
accountability log, and never changes a submission's status.

Without GPTZERO_API_KEY the check records "not_configured" instead of guessing.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path

import httpx

from .config import get_settings
from .db import SessionLocal, now
from .models import Submission, SubmissionCheck

logger = logging.getLogger("plare.ai_check")

GPTZERO_URL = "https://api.gptzero.me/v2/predict/text"
# GPTZero is unreliable on short text, so anything shorter isn't sent.
MIN_CHARS = 250
MAX_CHARS = 50_000
TIMEOUT_SECONDS = 30


class DetectorError(Exception):
    """The detector couldn't score the text. The message is safe to show to a reviewer."""


def pdf_text(data: bytes) -> str:
    """Text from a PDF, such as slides exported from Google Slides, PowerPoint, or Keynote."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:  # a damaged or encrypted PDF just has no checkable text
        return ""


def checkable_text(note: str, file_bytes: bytes | None, file_type: str | None) -> str:
    """Everything written in a submission: the note plus any PDF text. Photos have none."""
    parts = [note.strip()]
    if file_bytes and file_type == "application/pdf":
        parts.append(pdf_text(file_bytes).strip())
    return "\n\n".join(p for p in parts if p)[:MAX_CHARS]


def detect(text: str, api_key: str) -> tuple[float, str | None]:
    """Ask GPTZero how likely `text` is AI-written. Returns (probability 0..1, predicted class)."""
    try:
        res = httpx.post(
            GPTZERO_URL, json={"document": text}, timeout=TIMEOUT_SECONDS,
            headers={"x-api-key": api_key, "Accept": "application/json"},
        )
    except httpx.HTTPError as e:
        raise DetectorError("GPTZero didn't respond. Run the check again.") from e
    if res.status_code in (401, 403):
        raise DetectorError("GPTZero rejected the API key. Check GPTZERO_API_KEY on the server.")
    if res.status_code == 429:
        raise DetectorError("GPTZero's usage limit was reached. Run the check again later.")
    if res.status_code >= 400:
        raise DetectorError(f"GPTZero returned an error ({res.status_code}). Run the check again.")
    try:
        doc = res.json()["documents"][0]
        probs = doc.get("class_probabilities") or {}
        score = probs["ai"] if "ai" in probs else doc["completely_generated_prob"]
        return max(0.0, min(1.0, float(score))), doc.get("predicted_class")
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise DetectorError("GPTZero sent a response PLARE couldn't read. Run the check again.") from e


def initial_status(text: str) -> str:
    """What the check row starts as, decided before any network call."""
    if not text:
        return "skipped"
    if not get_settings().gptzero_api_key:
        return "not_configured"
    if len(text) < MIN_CHARS:
        return "too_short"
    return "pending"


def run_check(submission_id: str) -> None:
    """Score one pending submission. Runs after the response is sent, in its own session."""
    with SessionLocal() as db:
        sub = db.get(Submission, submission_id)
        check = db.get(SubmissionCheck, submission_id)
        if sub is None or check is None or check.ai_status != "pending":
            return
        data = None
        if sub.file_path:
            path = Path(get_settings().upload_dir) / sub.file_path
            data = path.read_bytes() if path.is_file() else None
        text = checkable_text(sub.text, data, sub.file_type)
        try:
            check.ai_score, check.ai_label = detect(text, get_settings().gptzero_api_key)
            check.ai_status, check.ai_error = "done", ""
        except DetectorError as e:
            check.ai_status, check.ai_error = "error", str(e)
        except Exception:
            logger.exception("AI check failed for submission %s", submission_id)
            check.ai_status, check.ai_error = "error", "The AI check failed. Run it again."
        check.ai_checked_at = now()
        db.commit()


def as_dict(check: SubmissionCheck | None) -> dict:
    """The check fields shown in the review queue and to the submitter."""
    if check is None:
        return {"captured_in_app": False, "captured_at": None, "ai_status": "skipped", "ai_score": None,
                "ai_label": None, "ai_error": "", "ai_checked_at": None}
    return {
        "captured_in_app": check.captured_at is not None, "captured_at": check.captured_at,
        "ai_status": check.ai_status, "ai_score": check.ai_score, "ai_label": check.ai_label,
        "ai_error": check.ai_error, "ai_checked_at": check.ai_checked_at,
    }
