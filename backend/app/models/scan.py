import enum
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ScanType(str, enum.Enum):
    URL = "url"
    EMAIL = "email"
    SMS = "sms"
    IMAGE = "image"
    QR = "qr"


_scan_type_column = Enum(
    ScanType,
    name="scan_type_enum",
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
    validate_strings=True,
)


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_type: Mapped[ScanType] = mapped_column(_scan_type_column)
    input_text: Mapped[str] = mapped_column(Text)
    risk_score: Mapped[int] = mapped_column(Integer)
    verdict: Mapped[str] = mapped_column(String(20))
    ai_summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    results: Mapped[list["ScanResult"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )


class ScanResult(Base):
    __tablename__ = "scan_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scans.id"))
    check: Mapped[str] = mapped_column(String(20))
    finding: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(10))

    scan: Mapped["Scan"] = relationship(back_populates="results")


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scans.id"))
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(Text)

    scan: Mapped["Scan"] = relationship()
