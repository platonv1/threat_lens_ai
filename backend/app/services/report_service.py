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

# reportlab's Paragraph/Table layout raises a LayoutError when a single
# unbroken "word" (no spaces to wrap at) is too long to fit in its column —
# e.g. a very long hostname embedded in a finding message. Truncating any
# scan-derived text before it reaches reportlab keeps report generation
# from ever failing on user-controlled input length.
_MAX_FIELD_LENGTH = 500


def _truncate(text: str) -> str:
    if len(text) > _MAX_FIELD_LENGTH:
        return text[:_MAX_FIELD_LENGTH] + "..."
    return text


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
    story.append(Paragraph(escape(_truncate(scan.input_text)), _styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Findings", _styles["Heading3"]))
    if scan.results:
        table_data = [["Check", "Severity", "Message"]]
        for result in scan.results:
            table_data.append(
                [
                    Paragraph(escape(_truncate(result.check)), _cell_style),
                    Paragraph(escape(_truncate(result.severity)), _cell_style),
                    Paragraph(escape(_truncate(result.finding)), _cell_style),
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
        image_flowable = None
        if Path(uploaded.path).is_file():
            try:
                # lazy=0 forces reportlab to read and decode the image now,
                # inside this try/except, rather than deferring it to
                # doc.build() below (its default "lazy" behavior) where a
                # decode failure would be unhandled and reach the caller.
                image_flowable = Image(
                    uploaded.path,
                    width=4 * inch,
                    height=4 * inch,
                    kind="proportional",
                    lazy=0,
                )
            except Exception:
                image_flowable = None
        story.append(image_flowable or Paragraph("Image unavailable.", _styles["Normal"]))

    doc.build(story)
    return buffer.getvalue()
