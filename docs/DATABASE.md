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