import asyncio
from unittest.mock import AsyncMock, patch

from app.schemas.scan import Finding
from app.services.ollama_service import summarize, summarize_message


def test_summarize_returns_ollama_response_text():
    fake_response = AsyncMock()
    fake_response.raise_for_status = lambda: None
    fake_response.json = lambda: {"response": "This looks safe."}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)):
        result = asyncio.run(
            summarize(
                "https://example.com",
                [Finding(check="dns", message="ok", severity="info")],
                0,
                "safe",
            )
        )

    assert result == "This looks safe."


def test_summarize_falls_back_when_ollama_unreachable():
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=Exception("connection refused"))):
        result = asyncio.run(
            summarize(
                "https://example.com",
                [Finding(check="dns", message="ok", severity="info")],
                0,
                "safe",
            )
        )

    assert result == "AI summary unavailable."


def test_summarize_message_returns_ollama_response_text():
    fake_response = AsyncMock()
    fake_response.raise_for_status = lambda: None
    fake_response.json = lambda: {"response": "This looks like a scam."}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)):
        result = asyncio.run(
            summarize_message(
                "email",
                [Finding(check="credential_request", message="Asks for a password.", severity="high")],
                40,
                "low-risk",
            )
        )

    assert result == "This looks like a scam."


def test_summarize_message_falls_back_when_ollama_unreachable():
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=Exception("connection refused"))):
        result = asyncio.run(
            summarize_message(
                "sms",
                [Finding(check="credential_request", message="Asks for a password.", severity="high")],
                40,
                "low-risk",
            )
        )

    assert result == "AI summary unavailable."
