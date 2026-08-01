from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, field_validator


class Finding(BaseModel):
    check: str
    message: str
    severity: Literal["info", "medium", "high"]


class URLScanRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def normalize_and_validate(cls, value: str) -> str:
        candidate = value.strip()
        if not candidate:
            raise ValueError("url must not be empty")
        if "://" not in candidate:
            candidate = f"https://{candidate}"
        hostname = urlparse(candidate).hostname
        if not hostname:
            raise ValueError("url must contain a valid hostname")
        return candidate


class MessageScanRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def normalize_and_validate(cls, value: str) -> str:
        candidate = value.strip()
        if not candidate:
            raise ValueError("text must not be empty")
        if len(candidate) > 20_000:
            raise ValueError("text must not exceed 20000 characters")
        return candidate


class ScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_type: str
    input_text: str
    risk_score: int
    verdict: str
    ai_summary: str
    findings: list[Finding]
    created_at: datetime
