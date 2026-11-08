# Deploying Two Futures

The backend (FastAPI) runs on **Render**. The frontend (Next.js) runs on **Vercel**.
The browser only talks to Vercel. Next proxies `/api/*` to Render on the server, so
Plaid and ElevenLabs keys never reach the browser.

Both platforms deploy from GitHub, so push `main` first.

## 1. Backend on Render

1. Sign in at render.com with GitHub, then choose **New > Blueprint** and pick this repo.
   It reads [`render.yaml`](../render.yaml).
2. When asked, fill in:
   - `PLAID_CLIENT_ID`, `PLAID_SECRET`: your **sandbox** keys from the Plaid dashboard.
   - `ALLOWED_ORIGINS`: your Vercel URL (you can fill this in after step 2; it isn't critical).
3. Wait for the deploy, then open `https://<your-service>.onrender.com/api/ping`.
   You should see `{"ok":true,...}`.

On the free plan the server sleeps after about 15 idle minutes. The first request after that
takes 30 to 60 seconds, so open the app a minute before a demo.

## 2. Frontend on Vercel

1. Sign in at vercel.com with GitHub, choose **Add New > Project** and import this repo.
2. Set **Root Directory** to `frontend`. The framework is detected as Next.js.
3. Add these environment variables before the first deploy:
   - `BACKEND_URL`: the Render URL, for example `https://two-futures-api.onrender.com`.
     This is required: the build stops if it's missing.
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`: for live voice (optional; saved answers work without them).
4. Deploy. If you change `BACKEND_URL` later, **redeploy**, because the proxy target is fixed at build time.

## Things to know

- **One bank connection for everyone.** The backend keeps a single Plaid connection in memory.
  If two visitors connect, the second replaces the first. A Render restart or sleep clears it.
- **Plaid sandbox login:** any test bank, `user_good` / `pass_good`, and code `1234` if asked.
  This all happens in Plaid's own window, on any device.
- **ElevenLabs credits** come from your key whenever any visitor talks to the voice agent.
  If the agent has an allowlist of hosts in its ElevenLabs security settings, add the Vercel domain.
- The developer pages (`/dev`, `/voice-lab`, `/grounding`, `/checklist`) are public too.
