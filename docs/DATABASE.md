# Database Design

## scans

- id
- scan_type
- input_text
- risk_score
- verdict
- ai_summary
- created_at

## uploaded_files

- id
- filename
- path
- scan_id

## scan_results

- id
- scan_id
- finding
- severity

## Data retention decision

`scans.input_text` persists indefinitely (no TTL, no auto-deletion, no encryption at rest beyond Postgres's own storage) — this can include pasted email/SMS content up to 20,000 chars, which may contain personal information from the source message.

Decision: no retention policy is implemented in this prototype. This is accepted as reasonable for a single-user, local-first tool where the data never leaves the user's own machine and there's no auth or multi-tenant access to guard against (see `SECURITY.md`'s auth/JWT scope decision). This is explicitly **not** acceptable as-is for a hosted/cloud deployment — revisit (TTL, encryption, explicit delete, or an opt-out of persistence) before this project's data ever leaves localhost.