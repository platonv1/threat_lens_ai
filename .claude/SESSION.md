# Session Log

## Completed

- Reviewed all docs in `.claude/` and `docs/` for architectural consistency.
- Scaffolded `frontend/` (Next.js, TypeScript, TailwindCSS, App Router) via `create-next-app`; placeholder home page, no feature UI.
- Scaffolded `backend/` (FastAPI) with layered structure: `app/api/routes`, `app/core`, `app/services`, `app/models`, `app/schemas`, `app/db`; only a `/health` endpoint implemented, no scan features.
- Verified both scaffolds run: backend `pytest` passes, frontend `npm run build` succeeds.
- Added root-level `.gitignore`.

## Current Focus

Project structure and Docker Compose are in place. No feature implementation yet.

- Added `docker-compose.yml` (root) wiring `db` (postgres:16-alpine), `backend`, and `frontend`; `Dockerfile`/`.dockerignore` in each service dir.
- Postgres exposed on host port **5433** (not 5432) — another local project (`phase-2-ocr-image-upload-postgres-1`) already holds 5432. Internal container-to-container traffic still uses port 5432.
- Ollama is expected to run on the host (per README), not in compose; backend reaches it via `http://host.docker.internal:11434` (compose sets `extra_hosts: host.docker.internal:host-gateway` for Linux compatibility).
- No DB schema/migrations yet — `DATABASE.md`'s tables aren't modeled in SQLAlchemy yet.
- Verified with `docker compose up -d`: db healthy, `GET /health` → `{"status":"ok"}`, frontend → 200. Stack was brought back down after verification (`docker compose down`) since it wasn't asked to stay running.

## Known Issues

- **SMS scanner gap**: `CLAUDE.md` and `PRD.md` list SMS message scanning as a core capability, but `FEATURES.md`, `API.md`, `DATABASE.md`, `TASKS.md`, and `ROADMAP.md` omit it entirely. Needs a decision: in scope or drop from vision docs.
- **Email Scanner untracked**: Email Scanner is a defined feature (`FEATURES.md`, `API.md`) but has no phase in `TASKS.md` or `ROADMAP.md`.
- Minor ambiguities to resolve before their respective features are designed: OCR engine choice (EasyOCR vs. Tesseract — primary/fallback unclear), LLM model choice (Llama 3.1 vs. Qwen), whether auth/JWT is in scope for this local-first prototype, `scans.scan_type` enum not defined, `UI_UX.md`'s Settings page has no backing feature.

## Next Goal

Resolve the SMS/Email planning gaps, then design the DB schema/SQLAlchemy models from `DATABASE.md` before implementing the first feature (URL Scanner, per `ROADMAP.md` Phase 2).