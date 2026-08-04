# Features

## URL Scanner

Status: Implemented

Description:
Analyze URLs using WHOIS, DNS, SSL, and a local LLM.

---

## Screenshot Scanner

Status: Implemented

Description:
Upload a screenshot and it's scanned automatically — text is extracted with OCR and analyzed for phishing indicators, with no review step (unlike the Email/SMS scanners' image-upload mode).

---

## Email Scanner

Status: Implemented

Description:
Analyze pasted email content for common scam patterns. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.

---

## SMS Scanner

Status: Implemented

Description:
Analyze pasted SMS text for common scam patterns (smishing links, urgency language, spoofed senders). Shares its analysis logic with the Email Scanner. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.

---

## QR Scanner

Status: Implemented

Description:
Decode a QR code from an uploaded image and run the decoded URL through the same WHOIS/DNS/SSL/AI-summary pipeline as the URL Scanner.

---

## AI Risk Explanation

Status: Planned

Description:
Generate a human-readable explanation and risk score using Ollama.