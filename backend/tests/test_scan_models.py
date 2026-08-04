from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.scan import Scan, ScanResult, UploadedFile


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_scan_result_round_trip():
    session = _make_session()
    scan = Scan(
        scan_type="url",
        input_text="https://example.com",
        risk_score=10,
        verdict="safe",
        ai_summary="Looks fine.",
    )
    scan.results = [ScanResult(check="dns", finding="Resolves fine.", severity="info")]

    session.add(scan)
    session.commit()
    session.refresh(scan)

    fetched = session.get(Scan, scan.id)
    assert fetched is not None
    assert fetched.risk_score == 10
    assert len(fetched.results) == 1
    assert fetched.results[0].check == "dns"
    assert fetched.results[0].severity == "info"
    assert isinstance(fetched.created_at, datetime)


def test_uploaded_file_round_trip():
    session = _make_session()
    scan = Scan(
        scan_type="image",
        input_text="URGENT verify your password",
        risk_score=55,
        verdict="suspicious",
        ai_summary="Looks like a scam.",
    )
    session.add(scan)
    session.commit()
    session.refresh(scan)

    uploaded = UploadedFile(scan_id=scan.id, filename="screenshot.png", path="/uploads/abc123.png")
    session.add(uploaded)
    session.commit()
    session.refresh(uploaded)

    fetched = session.get(UploadedFile, uploaded.id)
    assert fetched is not None
    assert fetched.scan_id == scan.id
    assert fetched.filename == "screenshot.png"
    assert fetched.path == "/uploads/abc123.png"
