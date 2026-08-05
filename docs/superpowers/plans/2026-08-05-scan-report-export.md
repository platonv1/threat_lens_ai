# Scan Report Export (Phase 7: Reporting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user download a single scan's results as a PDF from either the post-scan Results view or the History detail view.

**Architecture:** A new backend `report_service.generate_report(scan)` builds a PDF in memory (via `reportlab`) from an existing `Scan` ORM row, embedding any associated uploaded image; a new `GET /scan/{scan_id}/report` route serves it as `application/pdf`. The frontend adds one `downloadReport()` API client function and one button in the shared `ScanResultView` component, so both surfaces that render it get the feature from a single change.

**Tech Stack:** FastAPI, SQLAlchemy (existing `Scan`/`ScanResult`/`UploadedFile` models), `reportlab` (new dependency), Next.js/TypeScript, Vitest + React Testing Library.

## Global Constraints

- PDF is the only export format — no CSV, no other format (spec: "Out of scope").
- No aggregate/multi-scan reporting (dashboard, trends) — single-scan export only (spec: "Purpose").
- Generated PDFs are never persisted to disk or the database — built fresh in memory on every request (spec: "Architecture / data flow").
- `reportlab` only — no new system-level dependencies (e.g. no WeasyPrint/Pango/Cairo), matching `CLAUDE.md`'s "keep the architecture simple" and avoiding a repeat of the `easyocr`/CUDA Docker bloat noted in `.claude/SESSION.md` (spec: "Backend components").
- Whether an image is embedded is driven by `scan.uploaded_files` being non-empty, not by `scan_type` — do not hardcode a check against `ScanType.IMAGE`/`ScanType.QR` (spec: "Architecture / data flow"; also: today only Screenshot scans actually persist an `UploadedFile` row — QR scans decode and discard the image — so this must stay data-driven to keep working if that changes).
- A missing on-disk image file must degrade gracefully (report still generates, "Image unavailable" in its place) — never raise (spec: "Error handling").
- All user-influenced text embedded in the PDF (`input_text`, `ai_summary`, each finding's `check`/`severity`/`finding` message, each uploaded file's `filename`) must be XML-escaped before being placed in a `reportlab` `Paragraph`/`Table`, since `Paragraph` interprets a small HTML-like markup subset and unescaped `&`/`<`/`>` in a URL, pasted email/SMS text, or filename would corrupt the document or raise at render time.

---

### Task 1: Backend — `report_service.generate_report()`

**Files:**
- Modify: `backend/requirements.txt` (add `reportlab`)
- Create: `backend/app/services/report_service.py`
- Create: `backend/tests/test_report_service.py`

**Interfaces:**
- Consumes: `app.models.scan.Scan`, `ScanResult` (via `scan.results`), `UploadedFile` (via `scan.uploaded_files`) — all pre-existing, unchanged.
- Produces: `generate_report(scan: Scan) -> bytes` — the only symbol Task 2 depends on.

- [ ] **Step 1: Add `reportlab` to requirements and install it**

Add this line to `backend/requirements.txt`, anywhere after `python-multipart`:

```
reportlab
```

Install it into the project's existing virtualenv:

```bash
backend/.venv/bin/pip install reportlab
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_report_service.py`:

```python
import base64
from datetime import datetime

from app.models.scan import Scan, ScanResult, ScanType, UploadedFile
from app.services.report_service import generate_report

# A minimal valid 1x1 transparent PNG, used to test image embedding without
# depending on Pillow/OpenCV to generate a fixture at test time.
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _make_scan(**overrides) -> Scan:
    defaults = dict(
        id=1,
        scan_type=ScanType.URL,
        input_text="https://example.com",
        risk_score=55,
        verdict="suspicious",
        ai_summary="This looks risky.",
        created_at=datetime(2026, 8, 5, 12, 0, 0),
        results=[ScanResult(check="ssl", finding="Certificate expired.", severity="high")],
        uploaded_files=[],
    )
    defaults.update(overrides)
    return Scan(**defaults)


def test_generate_report_returns_valid_pdf_bytes():
    pdf_bytes = generate_report(_make_scan())

    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 0


def test_generate_report_handles_scan_with_no_findings():
    scan = _make_scan(results=[], risk_score=0, verdict="safe")

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")


def test_generate_report_embeds_uploaded_image(tmp_path):
    image_path = tmp_path / "screenshot.png"
    image_path.write_bytes(_PNG_1X1)
    scan = _make_scan(
        scan_type=ScanType.IMAGE,
        uploaded_files=[UploadedFile(filename="screenshot.png", path=str(image_path))],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")


def test_generate_report_degrades_gracefully_when_image_file_missing(tmp_path):
    missing_path = tmp_path / "gone.png"  # never written
    scan = _make_scan(
        scan_type=ScanType.IMAGE,
        uploaded_files=[UploadedFile(filename="gone.png", path=str(missing_path))],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")


def test_generate_report_escapes_special_characters_in_user_text():
    # Must not raise even though "&", "<", ">" have meaning in reportlab's
    # Paragraph markup.
    scan = _make_scan(
        input_text="https://example.com/?a=1&b=<script>alert(1)</script>",
        ai_summary="Contains <b>bold-looking</b> & ampersands.",
        results=[ScanResult(check="xss", finding="<img src=x> & stuff", severity="high")],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_report_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.report_service'`

- [ ] **Step 4: Write the implementation**

Create `backend/app/services/report_service.py`:

```python
from __future__ import annotations

import io
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.scan import Scan

_styles = getSampleStyleSheet()
# Table cell values must be Paragraph flowables, not plain strings: plain
# strings in a reportlab Table are drawn verbatim (no wrapping, and no XML
# markup parsing either) so a long finding message would overflow its
# column instead of wrapping, and escape()'d entities like "&amp;" would
# render literally instead of being unescaped back to "&".
_cell_style = ParagraphStyle("TableCell", parent=_styles["Normal"], fontSize=9, leading=11)


def generate_report(scan: Scan) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    story = []

    story.append(Paragraph(f"Scan Report &mdash; #{scan.id}", _styles["Title"]))
    story.append(
        Paragraph(
            f"Type: {escape(scan.scan_type.value)} &nbsp;&nbsp; "
            f"Created: {escape(scan.created_at.isoformat())}",
            _styles["Normal"],
        )
    )
    story.append(Spacer(1, 12))

    story.append(
        Paragraph(
            f"Verdict: {escape(scan.verdict)} (Risk Score: {scan.risk_score}/100)",
            _styles["Heading2"],
        )
    )
    story.append(Spacer(1, 6))

    story.append(Paragraph("Input", _styles["Heading3"]))
    story.append(Paragraph(escape(scan.input_text), _styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Findings", _styles["Heading3"]))
    if scan.results:
        table_data = [["Check", "Severity", "Message"]]
        for result in scan.results:
            table_data.append(
                [
                    Paragraph(escape(result.check), _cell_style),
                    Paragraph(escape(result.severity), _cell_style),
                    Paragraph(escape(result.finding), _cell_style),
                ]
            )
        table = Table(table_data, colWidths=[1.2 * inch, 0.9 * inch, 3.9 * inch])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("FONTSIZE", (0, 0), (0, 0), 9),
                ]
            )
        )
        story.append(table)
    else:
        story.append(Paragraph("No issues found.", _styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("AI Summary", _styles["Heading3"]))
    story.append(Paragraph(escape(scan.ai_summary), _styles["Normal"]))

    for uploaded in scan.uploaded_files:
        story.append(Spacer(1, 12))
        story.append(Paragraph(f"Uploaded Image: {escape(uploaded.filename)}", _styles["Heading3"]))
        if Path(uploaded.path).is_file():
            story.append(Image(uploaded.path, width=4 * inch, height=4 * inch, kind="proportional"))
        else:
            story.append(Paragraph("Image unavailable.", _styles["Normal"]))

    doc.build(story)
    return buffer.getvalue()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_report_service.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/services/report_service.py backend/tests/test_report_service.py
git commit -m "feat(backend): add report_service.generate_report() for PDF scan reports"
```

---

### Task 2: Backend — `GET /scan/{scan_id}/report` route

**Files:**
- Modify: `backend/app/api/routes/scan.py`
- Modify: `backend/tests/test_scan_route.py`

**Interfaces:**
- Consumes: `report_service.generate_report(scan: Scan) -> bytes` (Task 1).
- Produces: `GET /scan/{scan_id}/report` — `200` + `application/pdf` body + `Content-Disposition: attachment; filename="scan-{id}-report.pdf"` header on success, `404` if the scan doesn't exist. This is what Task 3's frontend `downloadReport()` calls.

- [ ] **Step 1: Write the failing tests**

Add to the end of `backend/tests/test_scan_route.py`:

```python
def test_get_scan_report_returns_pdf_for_existing_scan():
    with (
        patch(
            "app.services.url_scan_service.check_whois",
            return_value=Finding(check="whois", message="Domain registered long ago.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.check_dns",
            return_value=Finding(check="dns", message="Resolves fine.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.check_ssl",
            return_value=Finding(check="ssl", message="Valid HTTPS certificate.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.summarize",
            new=AsyncMock(return_value="This URL looks safe."),
        ),
    ):
        created = client.post("/scan/url", json={"url": "example.com"}).json()

    response = client.get(f"/scan/{created['id']}/report")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert f'scan-{created["id"]}-report.pdf' in response.headers["content-disposition"]


def test_get_scan_report_returns_404_for_unknown_id():
    response = client.get("/scan/999999/report")
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_scan_route.py -k report -v`
Expected: FAIL — `test_get_scan_report_returns_pdf_for_existing_scan` fails with a `404` (route doesn't exist yet) instead of `200`.

- [ ] **Step 3: Implement the route**

In `backend/app/api/routes/scan.py`, change the imports at the top from:

```python
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import ScanType
from app.schemas.scan import MessageScanRequest, ScanResponse, URLScanRequest
from app.services.image_scan_service import scan_image
from app.services.image_upload import read_validated_image
from app.services.message_scan_service import scan_message
from app.services.qr_scan_service import scan_qr
from app.services.scan_persistence import get_scan_by_id
from app.services.url_scan_service import scan_url as run_url_scan
```

to:

```python
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import Scan, ScanType
from app.schemas.scan import MessageScanRequest, ScanResponse, URLScanRequest
from app.services.image_scan_service import scan_image
from app.services.image_upload import read_validated_image
from app.services.message_scan_service import scan_message
from app.services.qr_scan_service import scan_qr
from app.services.report_service import generate_report
from app.services.scan_persistence import get_scan_by_id
from app.services.url_scan_service import scan_url as run_url_scan
```

Then add this route immediately after the existing `get_scan` route (the `GET /{scan_id}` handler):

```python
@router.get("/{scan_id}/report")
async def get_scan_report(scan_id: int, db: Session = Depends(get_db)) -> Response:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found.")

    pdf_bytes = generate_report(scan)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="scan-{scan_id}-report.pdf"'},
    )
```

- [ ] **Step 4: Run the full backend test suite to verify it passes**

Run: `backend/.venv/bin/pytest backend/tests/ -v`
Expected: PASS — all tests, including the 2 new ones and the 5 from Task 1.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/scan.py backend/tests/test_scan_route.py
git commit -m "feat(backend): add GET /scan/{id}/report endpoint"
```

---

### Task 3: Frontend — `downloadReport()` API client function

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `GET /scan/{scan_id}/report` (Task 2), the existing `API_URL`, `ScanError`, `extractErrorMessage` from the same file.
- Produces: `downloadReport(id: number): Promise<void>` — throws `ScanError` on a non-2xx response, otherwise triggers a browser file download as a side effect. This is what Task 4's `ScanResultView` button calls.

- [ ] **Step 1: Write the failing tests**

Add to the end of `frontend/src/lib/api.test.ts`:

```ts
describe("downloadReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the PDF and triggers a browser download", async () => {
    const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadReport(1);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("throws a ScanError with the backend's message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Scan not found." }),
      }),
    );

    await expect(downloadReport(999)).rejects.toThrow("Scan not found.");
    await expect(downloadReport(999)).rejects.toBeInstanceOf(ScanError);
  });
});
```

Add `downloadReport` to the existing import line at the top of the file (it currently reads `import { ScanError, extractText, scanEmail, scanSms, scanUrl } from "./api";`):

```ts
import { ScanError, downloadReport, extractText, scanEmail, scanSms, scanUrl } from "./api";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- api.test.ts`
Expected: FAIL — `downloadReport` is not exported from `./api`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/api.ts`, add this function after `deleteScan` (the last function in the file):

```ts
export async function downloadReport(id: number): Promise<void> {
  const response = await fetch(`${API_URL}/scan/${id}/report`);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `scan-${id}-report.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): add downloadReport() API client function"
```

---

### Task 4: Frontend — "Download Report" button in `ScanResultView`

**Files:**
- Modify: `frontend/src/components/ScanResultView.tsx`
- Create: `frontend/src/components/ScanResultView.test.tsx`

**Interfaces:**
- Consumes: `downloadReport(id: number): Promise<void>`, `ScanError` (Task 3); `ScanResponse` type (unchanged).
- Produces: no new exports — `ScanResultView` keeps its existing `{ result: ScanResponse }` props. This is the last task; nothing downstream depends on it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ScanResultView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ScanResultView } from "./ScanResultView";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, downloadReport: vi.fn() };
});

const RESULT = {
  id: 1,
  scan_type: "url",
  input_text: "https://example.com",
  risk_score: 0,
  verdict: "safe",
  ai_summary: "Looks safe.",
  findings: [],
  created_at: "2026-08-05T12:00:00",
};

describe("ScanResultView", () => {
  beforeEach(() => {
    vi.mocked(api.downloadReport).mockReset();
  });

  it("renders the risk meter and report card", () => {
    render(<ScanResultView result={RESULT} />);
    expect(screen.getByText("Looks safe.")).toBeInTheDocument();
  });

  it("downloads the report for this scan when the button is clicked", async () => {
    vi.mocked(api.downloadReport).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ScanResultView result={RESULT} />);

    await user.click(screen.getByRole("button", { name: "Download Report" }));

    expect(api.downloadReport).toHaveBeenCalledWith(1);
  });

  it("shows an error message when the download fails", async () => {
    vi.mocked(api.downloadReport).mockRejectedValue(new api.ScanError("Scan not found."));
    const user = userEvent.setup();
    render(<ScanResultView result={RESULT} />);

    await user.click(screen.getByRole("button", { name: "Download Report" }));

    expect(await screen.findByText("Scan not found.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- ScanResultView.test.tsx`
Expected: FAIL — no "Download Report" button exists yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `frontend/src/components/ScanResultView.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ScanResponse } from "@/types/scan";
import { downloadReport, ScanError } from "@/lib/api";
import { RiskMeter } from "./RiskMeter";
import { ReportCard } from "./ReportCard";

interface ScanResultViewProps {
  result: ScanResponse;
}

export function ScanResultView({ result }: ScanResultViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadReport(result.id);
    } catch (err) {
      setDownloadError(err instanceof ScanError ? err.message : "Failed to download report.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-6">
      <RiskMeter score={result.risk_score} verdict={result.verdict} />
      <ReportCard findings={result.findings} aiSummary={result.ai_summary} />
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
      >
        {downloading ? "Downloading…" : "Download Report"}
      </button>
      {downloadError && <p className="mt-2 text-red-600 dark:text-red-400">{downloadError}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the full frontend test suite to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — all existing test files (including `ScanForm.test.tsx`, `MessageScanForm.test.tsx`, `ScanDetail.test.tsx`, which all render `ScanResultView` indirectly) plus the 3 new tests. Also run `npx tsc --noEmit` and `npm run lint` — both expected clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ScanResultView.tsx frontend/src/components/ScanResultView.test.tsx
git commit -m "feat(frontend): add Download Report button to ScanResultView"
```

---

### Task 5: Docs, manual verification, and process follow-through

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/FEATURES.md`
- Modify: `docs/ROADMAP.md`
- Modify: `.claude/TASKS.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `.claude/SESSION.md`

**Interfaces:**
- Consumes: nothing new — this task only touches docs and does manual verification of Tasks 1–4's already-tested code.
- Produces: nothing consumed elsewhere — this is the last task in the plan.

- [ ] **Step 1: Update `docs/API.md`**

Add a new line after `GET /scan/{id}` (line 15):

```
GET /scan/{id}/report
```

So the file reads (in order): `POST /scan/url`, `POST /scan/image`, `POST /scan/email`, `POST /scan/sms`, `POST /ocr/extract`, `POST /scan/qr`, `GET /scan/{id}`, `GET /scan/{id}/report`, `GET /history`, `DELETE /history/{id}`.

- [ ] **Step 2: Update `docs/FEATURES.md`**

Add a new entry at the end of the file (after the "AI Risk Explanation" section):

```markdown

---

## Report Export

Status: Implemented

Description:
Download a single scan's results as a PDF from either the Results view (right after scanning) or the History detail view — both render the shared `ScanResultView` component, which has one "Download Report" button. The PDF includes the verdict, risk score, input (URL/text), findings table, and AI summary; for scans with an associated uploaded image (currently: Screenshot Scanner scans — QR scans decode and discard their image, so they have none to embed), the original image is embedded too. Generated on demand via `GET /scan/{id}/report`; never persisted to disk or the database.
```

- [ ] **Step 3: Update `docs/ROADMAP.md` and `.claude/TASKS.md`**

No text change needed in `docs/ROADMAP.md` — Phase 7 is already titled "Reporting" and roadmap phases aren't checkbox items.

In `.claude/TASKS.md`, change:

```markdown
## Phase 7

- [ ] Reports
```

to:

```markdown
## Phase 7

- [x] Reports (single-scan PDF export via GET /scan/{id}/report; see FEATURES.md "Report Export")
```

- [ ] **Step 4: Update `docs/TECH_STACK.md`**

Add a new section after "OCR" (before "Deployment"):

```markdown

Reporting

- reportlab (PDF generation)
```

- [ ] **Step 5: Manual verification against a real Docker backend**

Bring up the stack and confirm the feature works end-to-end, not just under mocked tests:

```bash
docker compose up -d --build db backend
cd frontend && npm run dev
```

In a browser: run a URL scan (no image), confirm the "Download Report" button appears under the results and downloads a PDF that opens correctly and shows the verdict/risk score/findings/AI summary. Then run a Screenshot scan (upload an image via the Screenshot Scanner tab), download its report, and confirm the uploaded image appears embedded in the PDF. Then visit `/history`, open a past scan's detail page, and confirm the same button/download works there too. Bring the stack back down afterward (`docker compose down`) since it wasn't asked to stay running.

- [ ] **Step 6: Update `.claude/SESSION.md`**

Append a new section at the end of the file, before the existing "## Next Goal" section, describing what was built this session (backend `report_service.py` + `GET /scan/{id}/report`, frontend `downloadReport()` + the `ScanResultView` button, the manual verification results from Step 5), and update "## Next Goal" to note Phase 7 is now complete and all 7 roadmap phases are done — call out any remaining known issues (the pre-existing `verdict`-enum and `RiskMeter` `low-risk` gaps, the `Settings` page gap, the EasyOCR runtime-download limitation) as the only open items, since no further phases remain in `docs/ROADMAP.md`.

- [ ] **Step 7: Commit**

```bash
git add docs/API.md docs/FEATURES.md .claude/TASKS.md docs/TECH_STACK.md .claude/SESSION.md
git commit -m "docs: close out Phase 7 (Report Export)"
```
