"""AI-writing check for submissions, using a free open-source detector on Hugging Face.

The score is a signal for the reviewer, not a verdict. Detectors misjudge human writing
(especially by non-native English speakers), and the free models were trained on older AI
models, so they miss a lot of current AI writing. The result is only shown in the review
queue and to the person who submitted. It never notifies anyone, never writes to the
accountability log, and never changes a submission's status.

Without HF_TOKEN the check records "not_configured" instead of guessing.
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

HF_URL = "https://router.huggingface.co/hf-inference/models/{model}"
# Short text gives meaningless scores, so anything shorter isn't sent.
MIN_CHARS = 250
MAX_CHARS = 50_000
# The detector reads about 512 tokens at a time, so longer work is scored in pieces.
CHUNK_CHARS = 1500
MAX_CHUNKS = 6
TIMEOUT_SECONDS = 30
# Model labels that mean "AI-written" and "human-written", lowercased. Covers the common detectors.
AI_LABELS = {"chatgpt", "fake", "ai", "machine", "generated", "ai-generated", "machine-generated"}
HUMAN_LABELS = {"human", "real", "human-written"}


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


def chunks(text: str) -> list[str]:
    """Split text into detector-sized pieces at word boundaries, keeping at most MAX_CHUNKS."""
    out, rest = [], text.strip()
    while rest and len(out) < MAX_CHUNKS:
        if len(rest) <= CHUNK_CHARS:
            out.append(rest)
            break
        cut = rest.rfind(" ", 0, CHUNK_CHARS)
        cut = cut if cut > CHUNK_CHARS // 2 else CHUNK_CHARS
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    return out


def _ai_probability(body) -> float:
    """Read the AI probability from a text-classification response: [[{label, score}]] or [{label, score}]."""
    rows = body[0] if body and isinstance(body[0], list) else body
    scores = {str(r["label"]).lower(): float(r["score"]) for r in rows}
    for label, score in scores.items():
        if label in AI_LABELS:
            return score
    for label, score in scores.items():
        if label in HUMAN_LABELS:
            return 1.0 - score
    raise ValueError(f"unknown labels {sorted(scores)}")


def _score_chunk(text: str, token: str, model: str) -> float:
    try:
        res = httpx.post(
            HF_URL.format(model=model), json={"inputs": text}, timeout=TIMEOUT_SECONDS,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    except httpx.HTTPError as e:
        raise DetectorError("Hugging Face didn't respond. Run the check again.") from e
    if res.status_code in (401, 403):
        raise DetectorError("Hugging Face rejected the token. Check HF_TOKEN on the server.")
    if res.status_code == 402:
        raise DetectorError("This month's free Hugging Face credits are used up. Run the check again next month.")
    if res.status_code == 404:
        raise DetectorError(f"The detector model {model} isn't available. Check HF_AI_DETECTOR_MODEL on the server.")
    if res.status_code == 429:
        raise DetectorError("Hugging Face's rate limit was reached. Run the check again in a few minutes.")
    if res.status_code == 503:
        raise DetectorError("The detector is starting up. Run the check again in a minute.")
    if res.status_code >= 400:
        raise DetectorError(f"Hugging Face returned an error ({res.status_code}). Run the check again.")
    try:
        return max(0.0, min(1.0, _ai_probability(res.json())))
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise DetectorError("The detector sent a response PLARE couldn't read. Run the check again.") from e


def detect(text: str, token: str) -> tuple[float, str | None]:
    """How likely `text` is AI-written: (probability 0..1, "ai" or "human").

    Long text is scored in pieces and averaged, weighted by each piece's length.
    """
    model = get_settings().hf_ai_detector_model
    pieces = chunks(text)
    if not pieces:
        raise DetectorError("There's no text to check.")
    total = sum(len(p) for p in pieces)
    score = sum(_score_chunk(p, token, model) * len(p) for p in pieces) / total
    return score, "ai" if score >= 0.5 else "human"


def initial_status(text: str) -> str:
    """What the check row starts as, decided before any network call."""
    if not text:
        return "skipped"
    if not get_settings().hf_token:
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
            check.ai_score, check.ai_label = detect(text, get_settings().hf_token)
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
