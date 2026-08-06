# Cyber Scam Shield Assistant AI

## Description

A local-first AI-powered cybersecurity prototype that analyzes URLs, screenshots, emails, QR codes, and SMS messages to detect phishing and scam content.

## Features

- URL Scanner
- Screenshot OCR
- QR Scanner
- Email Scanner
- AI Risk Analysis
- Scan History

## Tech Stack

- Next.js
- FastAPI
- PostgreSQL
- Ollama
- EasyOCR
- Docker Compose

## Running Locally

1. Clone the repository.
2. Install Docker Desktop.
3. Start Ollama and pull the required model.
4. Run `docker compose up`.
5. Open the frontend in your browser at `http://localhost:3000`. The backend is at `http://localhost:8000` (`/health` for a liveness check). PostgreSQL is exposed on host port `5433` (container-internal `5432`) to avoid clashing with other local Postgres instances.

## Project Status

Prototype under active development.