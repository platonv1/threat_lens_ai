# Current Tasks

## Phase 1

- [x] Project setup (frontend + backend scaffold)
- [x] Docker Compose (db, backend, frontend wired; verified end-to-end)
- [x] PostgreSQL (running in compose; no schema/models yet)
- [x] FastAPI (skeleton only, no routes beyond /health)
- [x] Next.js (skeleton only, no pages beyond placeholder home)

## Phase 2

- [x] URL Scanner
- [x] WHOIS
- [x] DNS
- [x] SSL Validation

## Phase 3

- [x] Email Scanner (POST /scan/email)
- [x] SMS Scanner (POST /scan/sms)
- [x] Shared scam-pattern detection service
- [x] Image upload (OCR) input mode for Email/SMS Scanner

## Phase 4

- [x] Screenshot OCR (POST /scan/image)
- [x] QR Detection (POST /scan/qr)

## Phase 5

- [x] Ollama Integration (verified end-to-end against a real Llama 3.1 model)
- [x] AI Risk Analysis (human-readable explanation via Ollama; risk score/verdict remain rule-based by design — see FEATURES.md)

## Phase 6

- [ ] GET /scan/{id}
- [ ] GET /history
- [ ] DELETE /history/{id}
- [ ] Frontend History page (list, scan detail view, delete)

## Phase 7

- [ ] Reports