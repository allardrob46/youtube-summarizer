"""Offline tests: no network, no Groq key needed. Run: python3 -m unittest -v test_app.py"""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

os.environ.setdefault("APP_PASSCODE", "test-passcode-123456")
os.environ.setdefault("GROQ_API_KEY", "test-key")

import app  # noqa: E402

# Talk to the local test server directly even if the machine has an HTTP proxy set.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ParseTests(unittest.TestCase):
    def test_video_ids(self):
        cases = {
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s": "dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc": "dQw4w9WgXcQ",
            "youtube.com/shorts/dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "https://vimeo.com/123": None,
            "not a link": None,
        }
        for text, expected in cases.items():
            self.assertEqual(app.parse_video_id(text), expected, text)

    def test_lines_and_chunks(self):
        snippets = [{"start": float(i * 4), "text": f"word{i}"} for i in range(300)]
        lines = app.transcript_lines(snippets)
        self.assertTrue(lines[0].startswith("[0:00] "))
        chunks = app.chunk_lines(lines, 500)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c) <= 500 for c in chunks))
        self.assertEqual("\n".join(chunks), "\n".join(lines))

    def test_fmt_ts(self):
        self.assertEqual(app.fmt_ts(65), "1:05")
        self.assertEqual(app.fmt_ts(3725), "1:02:05")


class CleanTests(unittest.TestCase):
    def test_clean_fills_and_clamps(self):
        raw = {
            "overview": " Hi ",
            "keyPoints": [{"timestamp": 9999, "text": "late"}, {"timestamp": "30", "text": "mid"}, {"text": ""}],
            "answers": [{"question": "other wording", "answer": "A1"}],
        }
        out = app.clean_summary(raw, ["Q1", "Q2"], 600)
        self.assertEqual(out["overview"], "Hi")
        self.assertEqual([p["timestamp"] for p in out["keyPoints"]], [30, 600])
        self.assertEqual(out["answers"][0], {"question": "Q1", "answer": "A1"})
        self.assertEqual(out["answers"][1]["question"], "Q2")


class MapReduceTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def fake_groq(system, user):
            self.calls.append(system)
            return {"overview": "part", "keyPoints": [{"timestamp": 5, "text": "p"}], "answers": []}

        self._orig = app.groq_json
        app.groq_json = fake_groq

    def tearDown(self):
        app.groq_json = self._orig

    def test_short_is_single_call(self):
        app.summarize_long("t", ["[0:00] hello"], [], 60)
        self.assertEqual(len(self.calls), 1)

    def test_long_maps_then_reduces(self):
        lines = [f"[{i}:00] " + "x" * 200 for i in range(400)]
        app.summarize_long("t", lines, ["q"], 24000)
        self.assertGreater(len(self.calls), 2)
        self.assertIn("ONE PART", self.calls[0])
        self.assertIn("combine notes", self.calls[-1])


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._orig = app.handle_summarize
        app.handle_summarize = lambda body: {
            "url": body["url"],
            "videoId": "dQw4w9WgXcQ",
            "title": "T",
            "questions": [],
            "summary": {"overview": "o", "keyPoints": [], "answers": []},
        }
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        app.handle_summarize = cls._orig

    def post(self, passcode, body):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/summarize",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-app-passcode": passcode},
            method="POST",
        )
        try:
            with OPENER.open(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_rejects_bad_passcode(self):
        status, body = self.post("wrong", {"url": "x"})
        self.assertEqual(status, 401)
        self.assertIn("error", body)

    def test_accepts_good_passcode(self):
        status, body = self.post(os.environ["APP_PASSCODE"], {"url": "https://youtu.be/dQw4w9WgXcQ", "questions": []})
        self.assertEqual(status, 200)
        self.assertEqual(body["videoId"], "dQw4w9WgXcQ")

    def test_health(self):
        with OPENER.open(f"http://127.0.0.1:{self.port}/health") as r:
            self.assertEqual(json.loads(r.read()), {"ok": True})


if __name__ == "__main__":
    unittest.main()
