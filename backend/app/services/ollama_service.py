import httpx

from app.core.config import get_settings
from app.schemas.scan import Finding

_FALLBACK_SUMMARY = "AI summary unavailable."


def _build_prompt(url: str, findings: list[Finding], score: int, verdict: str) -> str:
    findings_text = "\n".join(f"- [{f.severity}] {f.check}: {f.message}" for f in findings)
    return (
        f"You are a security assistant. A URL scan for {url} produced a risk score of "
        f"{score}/100 ({verdict}) based on these findings:\n{findings_text}\n\n"
        "Explain in 2-3 plain-language sentences whether this URL looks safe and why."
    )


_MESSAGE_LABELS = {"email": "email", "sms": "SMS message", "image": "screenshot"}


def _build_message_prompt(scan_type: str, findings: list[Finding], score: int, verdict: str) -> str:
    findings_text = "\n".join(f"- [{f.severity}] {f.check}: {f.message}" for f in findings)
    label = _MESSAGE_LABELS.get(scan_type, "message")
    return (
        f"You are a security assistant. A scan of a {label} produced a risk score of "
        f"{score}/100 ({verdict}) based on these findings:\n{findings_text}\n\n"
        f"Explain in 2-3 plain-language sentences whether this {label} looks like a scam and why."
    )


async def _generate(prompt: str) -> str:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={"model": settings.ollama_model, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            data = response.json()
            return str(data["response"]).strip()
    except Exception:
        return _FALLBACK_SUMMARY


async def summarize(url: str, findings: list[Finding], score: int, verdict: str) -> str:
    return await _generate(_build_prompt(url, findings, score, verdict))


async def summarize_message(scan_type: str, findings: list[Finding], score: int, verdict: str) -> str:
    return await _generate(_build_message_prompt(scan_type, findings, score, verdict))
