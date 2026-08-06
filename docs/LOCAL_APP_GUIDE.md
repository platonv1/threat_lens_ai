# App Guide: Running and Testing Locally

Step-by-step instructions for getting Cyber Scam Shield Assistant AI running on your machine and verifying it works.

## Prerequisites

- **Docker Desktop** — must be running before you start. If it isn't launched first, `docker compose` fails with a cryptic connection error.
- **Ollama** (optional, but needed for real AI-generated summaries instead of a fallback string) — `brew install ollama`.
- **~5GB free disk** the first time you use a Screenshot/QR/Email/SMS-image scan — EasyOCR downloads its model weights on first use. If you use Ollama, `llama3.1` is another ~4.9GB.

## Step 1 — Start Docker Desktop

Open Docker Desktop and wait until it shows "running" (green whale icon).

## Step 2 — (Optional) Start Ollama for real AI summaries

```bash
ollama serve &
ollama pull llama3.1
```

Skip this if you just want to try the app quickly — every scan still works, `ai_summary` just shows `"AI summary unavailable."` instead of a real explanation.

## Step 3 — Start the app

From the repo root:

```bash
docker compose up
```

First run takes a few minutes (building the backend image). Leave this running to see logs from all three services (`db`, `backend`, `frontend`), or use `docker compose up -d` to run detached.

No `.env` file is required — `docker-compose.yml` bakes in sensible defaults (Postgres user/password `postgres`/`postgres`, db name `threat_lens`). Copy `.env.example` → `.env` at the repo root only if you want to override those.

## Step 4 — Verify it's up

If you left Step 3's `docker compose up` running in the foreground, open a **new terminal window/tab** for this (the original one is busy streaming logs). If you ran `docker compose up -d`, you can reuse the same terminal.

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

Then open **http://localhost:3000** in your browser.

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Postgres | `localhost:5433` (mapped from the container's 5432 — avoids clashing with other local Postgres instances) |

## Step 5 — Try it out

1. **Scan tab** (home page) — enter a URL (e.g. `example.com`) and click Scan, or switch to the Email/SMS/Screenshot/QR Code tabs.
2. Click **Download Report** under any scan result to get a PDF.
3. **History** (navbar) — see past scans, click into one for detail + delete + download report there too.

## Step 6 — Shut it down

```bash
docker compose down          # stop and remove containers, keep data
docker compose down -v       # also wipe the Postgres volume (fresh DB next time)
```

## Running without Docker (faster iteration while coding)

```bash
# Backend — needs Postgres reachable at DATABASE_URL (see backend/.env.example)
cd backend
.venv/bin/uvicorn app.main:app --reload
# Serves on http://localhost:8000

# Frontend (separate terminal)
cd frontend
npm run dev
# Serves on http://localhost:3000
```

## Running the automated tests

```bash
# Backend
cd backend
.venv/bin/pytest tests/ -v

# Frontend
cd frontend
npm test

# Frontend type-check + lint
npx tsc --noEmit
npm run lint
```

## Manual testing checklist

Once the stack is up at `http://localhost:3000`, per `docs/TESTING.md`: URL scan, Screenshot upload, QR detection, Email analysis, SMS analysis, and downloading a PDF report from a fresh scan result or a History detail page.
