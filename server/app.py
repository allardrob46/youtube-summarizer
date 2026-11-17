#!/usr/bin/env python3
"""
YouTube Summarizer middleman server.

The phone app never talks to YouTube transcripts or Groq directly. It sends
{url, questions} here with an x-app-passcode header; this server:

  1. checks the passcode,
  2. fetches the video's captions (youtube-transcript-api),
  3. asks Groq for a summary, splitting long transcripts into parts first
     (map-reduce) so any length works,
  4. returns {url, videoId, title, questions, summary{overview, keyPoints, answers}}.

Only the Python standard library plus youtube-transcript-api. All secrets come
from environment variables (or a server/.env file); nothing is hard-coded.

Run:  python3 app.py            (reads server/.env if present)
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

log = logging.getLogger("ytsum")

# --------------------------------------------------------------------------- config


def load_dotenv(path: Path) -> None:
    """Tiny .env reader: KEY=value lines, # comments. Real env vars win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_dotenv(Path(__file__).with_name(".env"))


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


APP_PASSCODE = os.environ.get("APP_PASSCODE", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
# llama-3.3-70b-versatile is listed as Enterprise-only on Groq's models page
# (checked Nov 2026), so the default is GPT-OSS 120B, which is on the
# self-serve plan and supports strict JSON-schema output.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_REASONING_EFFORT = os.environ.get("GROQ_REASONING_EFFORT", "low")
GROQ_URL = os.environ.get("GROQ_URL", "https://api.groq.com/openai/v1/chat/completions")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = env_int("PORT", 8787)
# Roughly 4 characters per token: 24k chars is about 6k tokens per part.
CHUNK_CHARS = env_int("CHUNK_CHARS", 24000)
MAX_PER_HOUR = env_int("MAX_PER_HOUR", 60)
TRANSCRIPT_LANGS = [x.strip() for x in os.environ.get("TRANSCRIPT_LANGS", "en").split(",") if x.strip()]
YT_PROXY_URL = os.environ.get("YT_PROXY_URL", "")

MAX_BODY_BYTES = 16 * 1024
MAX_QUESTIONS = 5
MAX_QUESTION_CHARS = 300

# Models Groq documents as supporting strict json_schema output.
STRICT_SCHEMA_MODELS = ("openai/gpt-oss-", "qwen/qwen3", "meta-models/muse-spark")

# --------------------------------------------------------------------------- errors


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------------- youtube

ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def parse_video_id(text: str) -> str | None:
    text = (text or "").strip()
    if ID_RE.match(text):
        return text
    if not re.match(r"^https?://", text, re.I):
        text = "https://" + text
    try:
        u = urllib.parse.urlparse(text)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    parts = [p for p in u.path.split("/") if p]
    if host == "youtu.be" and parts:
        return parts[0] if ID_RE.match(parts[0]) else None
    if host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        v = urllib.parse.parse_qs(u.query).get("v", [""])[0]
        if ID_RE.match(v):
            return v
        if len(parts) >= 2 and parts[0] in ("shorts", "live", "embed", "v") and ID_RE.match(parts[1]):
            return parts[1]
    return None


def fetch_title(video_id: str) -> str:
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(
        f"https://www.youtube.com/watch?v={video_id}", safe=""
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
            return str(data.get("title") or "Untitled video")
    except Exception:  # noqa: BLE001 - title is nice to have, never fatal
        return "Untitled video"


def fetch_transcript(video_id: str) -> list[dict[str, float | str]]:
    """Returns [{start, text}] from captions. Raises ApiError with a plain message."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api import _errors as yte
        from youtube_transcript_api.proxies import GenericProxyConfig
    except ImportError as exc:  # pragma: no cover
        raise ApiError(500, "Server is missing youtube-transcript-api. Run: pip install -r requirements.txt") from exc

    proxy = GenericProxyConfig(http_url=YT_PROXY_URL, https_url=YT_PROXY_URL) if YT_PROXY_URL else None
    api = YouTubeTranscriptApi(proxy_config=proxy)  # one instance per request: not thread-safe
    try:
        listing = api.list(video_id)
        try:
            transcript = listing.find_transcript(TRANSCRIPT_LANGS)
        except yte.NoTranscriptFound:
            # Any language is better than nothing; the model is told to answer in English.
            transcript = next(iter(listing), None)
            if transcript is None:
                raise
        fetched = transcript.fetch()
    except (yte.TranscriptsDisabled, yte.NoTranscriptFound):
        raise ApiError(422, "This video has no captions, so it cannot be summarized yet.")
    except (yte.VideoUnavailable, yte.InvalidVideoId):
        raise ApiError(404, "That video is unavailable or private.")
    except yte.AgeRestricted:
        raise ApiError(422, "That video is age-restricted, so its captions cannot be read.")
    except yte.RequestBlocked:  # includes IpBlocked
        raise ApiError(
            503,
            "YouTube is blocking caption requests from this server's IP address. "
            "Set YT_PROXY_URL on the server (see the README).",
        )
    except yte.CouldNotRetrieveTranscript as exc:
        log.warning("transcript failed for %s: %s", video_id, type(exc).__name__)
        raise ApiError(502, "Could not read this video's captions right now. Try again in a minute.")

    return [{"start": float(s.start), "text": s.text.replace("\n", " ").strip()} for s in fetched if s.text.strip()]


def fmt_ts(seconds: float) -> str:
    s = max(0, int(seconds))
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def transcript_lines(snippets: list[dict[str, Any]], window: float = 15.0) -> list[str]:
    """Merge caption snippets into ~15-second lines like '[1:05] text' (fewer tokens, timestamps kept)."""
    lines: list[str] = []
    start: float | None = None
    buf: list[str] = []
    for s in snippets:
        if start is None:
            start = float(s["start"])
        buf.append(str(s["text"]))
        if float(s["start"]) - start >= window:
            lines.append(f"[{fmt_ts(start)}] {' '.join(buf)}")
            start, buf = None, []
    if buf and start is not None:
        lines.append(f"[{fmt_ts(start)}] {' '.join(buf)}")
    return lines


def chunk_lines(lines: list[str], limit: int) -> list[str]:
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for line in lines:
        if cur and size + len(line) + 1 > limit:
            chunks.append("\n".join(cur))
            cur, size = [], 0
        cur.append(line)
        size += len(line) + 1
    if cur:
        chunks.append("\n".join(cur))
    return chunks


# --------------------------------------------------------------------------- groq

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "keyPoints": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "timestamp": {"type": "integer", "description": "Seconds from the start of the video"},
                    "text": {"type": "string"},
                },
                "required": ["timestamp", "text"],
                "additionalProperties": False,
            },
        },
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}},
                "required": ["question", "answer"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["overview", "keyPoints", "answers"],
    "additionalProperties": False,
}

RULES = """Rules:
- Use only what is in the transcript. Never invent facts, names, numbers or timestamps.
- Write in plain, clear English even if the transcript is in another language.
- keyPoints: each has "timestamp" as whole SECONDS (convert [m:ss] or [h:mm:ss] to seconds) taken from the line where the point starts, and "text" as one or two sentences.
- answers: one entry per question, in the same order, with the question copied exactly. If the transcript does not cover a question, say so plainly in the answer.
- Reply with JSON only, matching: {"overview": string, "keyPoints": [{"timestamp": integer, "text": string}], "answers": [{"question": string, "answer": string}]}"""


def groq_json(system: str, user: str) -> dict[str, Any]:
    if not GROQ_API_KEY:
        raise ApiError(500, "Server is missing GROQ_API_KEY.")
    strict = GROQ_MODEL.startswith(STRICT_SCHEMA_MODELS)
    body: dict[str, Any] = {
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_completion_tokens": 8192,
        "response_format": (
            {"type": "json_schema", "json_schema": {"name": "video_summary", "strict": True, "schema": SUMMARY_SCHEMA}}
            if strict
            else {"type": "json_object"}
        ),
    }
    if GROQ_MODEL.startswith("openai/gpt-oss-") and GROQ_REASONING_EFFORT:
        body["reasoning_effort"] = GROQ_REASONING_EFFORT

    data = json.dumps(body).encode("utf-8")
    for attempt in range(4):
        req = urllib.request.Request(
            GROQ_URL,
            data=data,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "yt-summarizer/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = json.loads(r.read().decode("utf-8"))
            content = payload["choices"][0]["message"]["content"] or "{}"
            return json.loads(content)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            if exc.code in (429, 500, 502, 503) and attempt < 3:
                wait = float(exc.headers.get("retry-after") or 2 ** (attempt + 1))
                log.info("groq %s, retrying in %.1fs", exc.code, wait)
                time.sleep(min(wait, 30))
                continue
            log.error("groq error %s: %s", exc.code, detail)
            if exc.code == 401:
                raise ApiError(502, "Groq rejected the server's API key.")
            if exc.code == 429:
                raise ApiError(503, "Groq rate limit reached. Try again in a minute.")
            raise ApiError(502, f"Groq returned an error ({exc.code}).")
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            raise ApiError(502, "Could not reach Groq.") from exc
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            if attempt < 3:
                continue
            raise ApiError(502, "Groq sent back something that was not valid JSON.") from exc
    raise ApiError(502, "Groq did not answer.")


def questions_block(questions: list[str]) -> str:
    if not questions:
        return "The viewer asked no questions, so answers must be an empty list."
    listed = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
    return "The viewer wants these questions answered (this is what they are looking for):\n" + listed


def key_point_target(duration_s: float) -> int:
    return int(min(25, max(5, 5 + duration_s / 300)))


def summarize_text(title: str, transcript: str, questions: list[str], duration_s: float) -> dict[str, Any]:
    system = (
        "You summarize YouTube videos for a self-taught learner who wants the substance fast. "
        "Lead with what the viewer is looking for.\n" + RULES
    )
    user = (
        f"Video title: {title}\n{questions_block(questions)}\n"
        f"Give an overview of 3 to 6 sentences and about {key_point_target(duration_s)} key points.\n\n"
        f"Transcript (each line starts with its time):\n{transcript}"
    )
    return groq_json(system, user)


def map_chunk(title: str, chunk: str, part: int, total: int, questions: list[str]) -> dict[str, Any]:
    system = (
        "You take notes on ONE PART of a long YouTube video transcript. Other parts are handled separately.\n"
        + RULES
        + "\n- overview: 2 to 4 sentences on this part only.\n"
        "- answers: for each question, what THIS PART says. Use an empty string if this part says nothing about it."
    )
    user = (
        f"Video title: {title}\nThis is part {part} of {total}.\n{questions_block(questions)}\n\n"
        f"Transcript part:\n{chunk}"
    )
    return groq_json(system, user)


def reduce_notes(title: str, notes: list[dict[str, Any]], questions: list[str], duration_s: float) -> dict[str, Any]:
    system = (
        "You combine notes from consecutive parts of one long YouTube video into a single summary.\n"
        + RULES
        + "\n- Only use timestamps that appear in the notes. Merge duplicates and keep the most useful points in time order."
    )
    user = (
        f"Video title: {title}\n{questions_block(questions)}\n"
        f"Write a whole-video overview of 4 to 8 sentences and about {key_point_target(duration_s)} key points.\n\n"
        "Notes per part, in order:\n" + json.dumps(notes, ensure_ascii=False)
    )
    return groq_json(system, user)


def summarize_long(title: str, lines: list[str], questions: list[str], duration_s: float) -> dict[str, Any]:
    chunks = chunk_lines(lines, CHUNK_CHARS)
    if len(chunks) == 1:
        return summarize_text(title, chunks[0], questions, duration_s)
    log.info("map-reduce over %d parts", len(chunks))
    notes = [map_chunk(title, c, i + 1, len(chunks), questions) for i, c in enumerate(chunks)]
    # Very long videos: if the notes themselves are too big, reduce them in groups first.
    while len(json.dumps(notes, ensure_ascii=False)) > CHUNK_CHARS * 2 and len(notes) > 1:
        groups, cur, size = [], [], 0
        for n in notes:
            n_size = len(json.dumps(n, ensure_ascii=False))
            if cur and size + n_size > CHUNK_CHARS * 2:
                groups.append(cur)
                cur, size = [], 0
            cur.append(n)
            size += n_size
        groups.append(cur)
        if len(groups) == len(notes):  # each note alone is too big; stop shrinking
            break
        notes = [reduce_notes(title, g, questions, duration_s / max(1, len(groups))) for g in groups]
    return reduce_notes(title, notes, questions, duration_s)


def clean_summary(raw: dict[str, Any], questions: list[str], duration_s: float) -> dict[str, Any]:
    """Make the model's output match the app's shape exactly, whatever it sent."""
    overview = str(raw.get("overview") or "").strip()
    points = []
    for kp in raw.get("keyPoints") or []:
        if not isinstance(kp, dict) or not str(kp.get("text") or "").strip():
            continue
        try:
            ts = int(float(kp.get("timestamp") or 0))
        except (TypeError, ValueError):
            ts = 0
        ts = max(0, min(ts, int(duration_s) if duration_s else ts))
        points.append({"timestamp": ts, "text": str(kp["text"]).strip()})
    points.sort(key=lambda p: p["timestamp"])

    by_q = {}
    for a in raw.get("answers") or []:
        if isinstance(a, dict):
            by_q[str(a.get("question") or "").strip().lower()] = str(a.get("answer") or "").strip()
    raw_answers = [a for a in (raw.get("answers") or []) if isinstance(a, dict)]
    answers = []
    for i, q in enumerate(questions):
        ans = by_q.get(q.strip().lower())
        if ans is None and i < len(raw_answers):
            ans = str(raw_answers[i].get("answer") or "").strip()
        answers.append({"question": q, "answer": ans or "The video does not seem to cover this."})
    return {"overview": overview, "keyPoints": points, "answers": answers}


# --------------------------------------------------------------------------- request handling

_hits: deque[float] = deque()
_hits_lock = threading.Lock()


def allow_request() -> bool:
    """Global cap on summaries per hour, to protect the Groq bill if the passcode leaks."""
    now = time.time()
    with _hits_lock:
        while _hits and now - _hits[0] > 3600:
            _hits.popleft()
        if len(_hits) >= MAX_PER_HOUR:
            return False
        _hits.append(now)
        return True


def handle_summarize(body: dict[str, Any]) -> dict[str, Any]:
    url = str(body.get("url") or "").strip()
    video_id = parse_video_id(url)
    if not video_id:
        raise ApiError(400, "That does not look like a YouTube video link.")
    raw_q = body.get("questions") or []
    if not isinstance(raw_q, list):
        raise ApiError(400, "questions must be a list.")
    questions = [str(q).strip()[:MAX_QUESTION_CHARS] for q in raw_q if str(q).strip()][:MAX_QUESTIONS]

    title = fetch_title(video_id)
    snippets = fetch_transcript(video_id)
    if not snippets:
        raise ApiError(422, "This video's captions are empty.")
    duration = float(snippets[-1]["start"]) + 5
    lines = transcript_lines(snippets)
    raw = summarize_long(title, lines, questions, duration)
    return {
        "url": url,
        "videoId": video_id,
        "title": title,
        "questions": questions,
        "summary": clean_summary(raw, questions, duration),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "yt-summarizer/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:  # route to logging, never log bodies
        log.info("%s %s", self.address_string(), fmt % args)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0].rstrip("/") not in ("", "/summarize"):
            self.send_json(404, {"error": "Not found."})
            return
        supplied = self.headers.get("x-app-passcode", "")
        if not hmac.compare_digest(supplied.encode("utf-8"), APP_PASSCODE.encode("utf-8")):
            self.send_json(401, {"error": "The passcode was not accepted."})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(400, {"error": "Send a small JSON body: {url, questions}."})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Body must be JSON: {url, questions}."})
            return
        if not allow_request():
            self.send_json(429, {"error": "Hourly limit reached on the server. Try again later."})
            return
        started = time.time()
        try:
            result = handle_summarize(body)
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message})
            return
        except Exception:  # noqa: BLE001
            log.exception("unexpected error")
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The server hit an unexpected error."})
            return
        log.info("summarized %s in %.1fs", result["videoId"], time.time() - started)
        self.send_json(200, result)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    missing = [n for n, v in (("APP_PASSCODE", APP_PASSCODE), ("GROQ_API_KEY", GROQ_API_KEY)) if not v]
    if missing:
        sys.exit(f"Missing required environment variables: {', '.join(missing)}. See server/.env.example.")
    if len(APP_PASSCODE) < 12:
        log.warning("APP_PASSCODE is short; use at least 12 random characters.")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("listening on http://%s:%d (model %s)", HOST, PORT, GROQ_MODEL)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
