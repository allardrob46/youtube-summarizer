# YT Summarizer

Paste a YouTube link, say what you're looking for, and get back a short overview, the key points with timestamps you can tap, and straight answers to your questions. Then add your own notes under it. Everything you save stays on your phone.

Built for studying long tutorials and talks without scrubbing through them twice.

## What it does

- **Ask before you watch.** Add up to five questions ("Which tools does he recommend?") and the summary answers them first.
- **Timestamps that work.** Every key point carries the moment it happens. Tap the time and YouTube opens right there.
- **Any length.** Long videos are split into parts on the server, summarized part by part, then stitched into one summary.
- **Notes with the summary.** Write what you want to remember under each summary; it saves as you type.
- **A library on your phone.** Keep the ones that matter (they pin to the top) and delete the rest. No account, no cloud.
- **Demo mode.** With no server set up, the app makes sample summaries so you can try every screen first.

## Screenshots

_Coming soon: Summarize, Library, and Summary screens on Android, light and dark._

<!-- Add images to docs/screenshots/ and link them here, e.g.
![Summarize screen](docs/screenshots/summarize.png)
-->

## How it works

```
Phone app  ──POST {url, questions} + x-app-passcode──▶  Small Python server  ──▶  YouTube captions
(Expo, on-device storage)                               (your VPS, behind Caddy)  ──▶  Groq LLM
           ◀──────── {title, overview, keyPoints, answers} ────────┘
```

The app never holds the Groq API key. The server checks a passcode, reads the video's captions, asks Groq for a structured summary, and sends it back.

## Stack

| Part | What |
| --- | --- |
| App | Expo SDK 58, React Native 0.88, TypeScript, Expo Router |
| UI | [HeroUI Native](https://heroui.com/docs/native) 1.0.11 with Uniwind (Tailwind CSS v4) |
| Storage | AsyncStorage, on the device only |
| Server | Python 3 standard library + [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) |
| AI | [Groq](https://console.groq.com/docs/models), default model `openai/gpt-oss-120b` with strict JSON-schema output |
| APK | GitHub Actions: `expo prebuild` + Gradle, no Expo account |

## Project layout

```
src/
  app/
    (tabs)/index.tsx      Summarize screen
    (tabs)/library.tsx    Library screen
    summary/[id].tsx      Summary detail + notes
  components/             Shared UI bits and the Connection dialog
  lib/storage.ts          The one storage module every screen uses (typed Summary)
  lib/api.ts              Server client, with demo mode
  lib/youtube.ts          Link parsing, timestamps, deep links
server/
  app.py                  The middleman server
  test_app.py             Offline tests
  deploy/                 Caddy and systemd examples
.github/workflows/build-apk.yml
```

## Run the app

Needs Node 22+.

```bash
npm install
cp .env.example .env      # optional; leave empty for demo mode
npx expo start            # open in a development build or emulator
```

HeroUI Native targets iOS and Android (not web). Because the app uses native modules beyond Expo Go's set, the easiest way to try it on a phone is the APK from GitHub Actions (below).

Checks:

```bash
npm run typecheck
npm run lint
npx expo-doctor
```

### Settings

| Variable | Where | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_SERVER_URL` | `.env` (app) | Full address of the summarize route, e.g. `https://yt.example.com/summarize`. Empty means demo mode. |
| `EXPO_PUBLIC_APP_PASSCODE` | `.env` (app) | Must match the server's `APP_PASSCODE`. |

Both can also be typed into the app under **Connection**, which overrides the built-in values. Anything starting with `EXPO_PUBLIC_` is readable inside the APK, so for a public build prefer entering the passcode in the app.

## Run the server

Needs Python 3.10+.

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env      # fill in APP_PASSCODE and GROQ_API_KEY
.venv/bin/python app.py   # listens on 127.0.0.1:8787
.venv/bin/python -m unittest -v test_app.py
```

API:

- `POST /summarize` with header `x-app-passcode` and body `{"url": "...", "questions": ["..."]}`
- returns `{"url", "videoId", "title", "questions", "summary": {"overview", "keyPoints": [{"timestamp", "text"}], "answers": [{"question", "answer"}]}}`; `timestamp` is whole seconds
- errors return `{"error": "plain message"}` with a fitting status (401 passcode, 422 no captions, 503 blocked or rate-limited)
- `GET /health` returns `{"ok": true}`

Server settings (all in `server/.env.example`): `APP_PASSCODE`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_REASONING_EFFORT`, `HOST`, `PORT`, `CHUNK_CHARS`, `MAX_PER_HOUR`, `TRANSCRIPT_LANGS`, `YT_PROXY_URL`.

### Deploy behind Caddy

- `server/deploy/Caddyfile.example`: HTTPS reverse proxy with a 5-minute timeout for long videos.
- `server/deploy/yt-summarizer.service`: systemd unit that runs the server as its own user and restarts it on failure.

### Known limits

- **Captions only.** Videos without captions (manual or auto-generated) return a clear "no captions" error. Audio transcription is a possible later addition.
- **YouTube blocks many datacenter IPs.** Caption requests from cloud servers (VPS, AWS, GCP and similar) are often refused. The server reports this as a 503 with a plain message. The fix is to set `YT_PROXY_URL` to a residential proxy. Test with a real video right after deploying.
- **Model availability changes.** On Groq's models page `llama-3.3-70b-versatile` is listed for Enterprise accounts; the default here is `openai/gpt-oss-120b`. Set `GROQ_MODEL` to switch.

## Build the APK

`.github/workflows/build-apk.yml` runs on a manual trigger (Actions > Build APK > Run workflow) or on a `v*` tag. It type-checks the app, runs the server tests, generates the Android project, builds a release APK signed with the template debug key, uploads it to the run, and attaches it to a GitHub Release.

Optional repository secret: `SERVER_URL`. The passcode is never baked into the APK.

## License

Not chosen yet.
