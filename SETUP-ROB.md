# Setting it up, step by step (Rob)

All of this works from your phone. Where a step is quicker on a computer, it says so. The app works in demo mode before any of this, so you can do it in stages.

## Stage 1: Get the app on your phone (demo mode)

1. **Put the code on GitHub.** Make a new repository called `youtube-summarizer` and upload this project to it. (Hark can walk you through this or do it with you.)
2. **Build the app.** In the repository, tap **Actions**, then **Build APK**, then **Run workflow**, then the green **Run workflow** button. Wait about 15 to 25 minutes. A green check means it worked.
3. **Download it.** Go to the repository's **Releases** (on the main page, right side, or under the menu). Open the newest one and tap the file ending in `.apk`.
4. **Install it.** Android asks whether your browser may install apps. Say yes for this one install. Open **YT Summarizer**.
5. **Try it.** Paste any YouTube link and tap **Summarize video**. You get a sample summary marked "Demo". Tap a time to see it open YouTube at that moment. Check the Library and try writing a note.

Why the warning when installing: the app is not from the Play Store, so Android asks first. That is normal for apps you build yourself.

## Stage 2: Set up the server (real summaries)

You need: your VPS, a domain or subdomain pointing at it (for example `yt.yourdomain.com`), and a Groq account.

1. **Get a Groq key.** Sign in at console.groq.com, open **API Keys**, make a key, and copy it somewhere safe. Never paste it into the app or into GitHub.
2. **Make a passcode.** Any long random string. On the server you can run:
   `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`
3. **Put the server code on the VPS** (in Termux, `ssh` into the VPS first):
   ```
   sudo git clone https://github.com/YOUR-NAME/youtube-summarizer /opt/youtube-summarizer
   cd /opt/youtube-summarizer/server
   sudo python3 -m venv .venv
   sudo .venv/bin/pip install -r requirements.txt
   sudo cp .env.example .env
   sudo nano .env
   ```
   In `nano`, fill in `APP_PASSCODE=` and `GROQ_API_KEY=`. Save with Ctrl+O, Enter, then exit with Ctrl+X.
4. **Quick test:** `sudo .venv/bin/python app.py`. If it says `listening on http://127.0.0.1:8787`, it works. Stop it with Ctrl+C.
5. **Keep it running.** Make a user for it and install the service:
   ```
   sudo useradd --system --no-create-home ytsum
   sudo chown -R ytsum:ytsum /opt/youtube-summarizer/server
   sudo cp deploy/yt-summarizer.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now yt-summarizer
   ```
6. **Put Caddy in front.** Copy the block from `deploy/Caddyfile.example` into `/etc/caddy/Caddyfile`, change `yt.example.com` to your subdomain, then `sudo systemctl reload caddy`. Caddy gets the HTTPS certificate by itself.
7. **Check it from your phone's browser:** open `https://yt.yourdomain.com/health`. You should see `{"ok": true}`.

## Stage 3: Connect the app

1. Open the app, tap **Connection** (top right of the Summarize screen).
2. Server address: `https://yt.yourdomain.com/summarize`
3. Passcode: the same one you put in `.env`.
4. Tap **Save connection**. The chip at the top changes from "Demo mode" to "Server connected".
5. Summarize a real video.

The passcode is saved only on your phone. It is not in the app file on GitHub.

## If something goes wrong

- **"YouTube is blocking caption requests from this server's IP"**: YouTube refuses many cloud servers. The fix is a residential proxy: put its address in `YT_PROXY_URL=` in `.env`, then `sudo systemctl restart yt-summarizer`.
- **"This video has no captions"**: that video has no subtitles at all, so there is nothing to read yet.
- **"The passcode was not accepted"**: the passcode in the app and in `.env` don't match exactly.
- **"Groq rejected the server's API key"**: check `GROQ_API_KEY` in `.env`.
- **"Could not reach the server"**: check `https://yt.yourdomain.com/health` in your browser first.
- **See what the server is doing:** `journalctl -u yt-summarizer -f`

## Updating later

- **App:** after changes land on GitHub, run **Build APK** again and install the new APK over the old one. Your library and notes stay.
- **Server:** `cd /opt/youtube-summarizer && sudo git pull && sudo systemctl restart yt-summarizer`
