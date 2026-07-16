#!/usr/bin/env python3
"""Generate the shareable Wizmatch Team SOP PDF from approved copy and screenshots."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "wizmatch" / "sop-assets"
OUTPUT = ROOT / "output" / "pdf" / "Wizmatch-Team-SOP.pdf"


def image_block(filename: str, max_width: float = 180 * mm, max_height: float = 105 * mm):
    path = ASSETS / filename
    image = Image(str(path))
    scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    return image


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(18 * mm, 12 * mm, "Wizmatch Staffing OS - Team SOP")
    canvas.drawRightString(192 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def bullets(items, styles):
    blocks = []
    for item in items:
        blocks.append(Paragraph(f"- {item}", styles["BodyText"]))
        blocks.append(Spacer(1, 1.5 * mm))
    return blocks


def section(story, styles, title, intro, screenshot=None, items=None):
    story.append(Paragraph(title, styles["Heading1"]))
    story.append(Paragraph(intro, styles["BodyText"]))
    story.append(Spacer(1, 3 * mm))
    if screenshot:
        story.append(image_block(screenshot))
        story.append(Spacer(1, 4 * mm))
    if items:
        story.extend(bullets(items, styles))


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="TitleWM",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=25,
        leading=30,
        textColor=colors.HexColor("#173B8F"),
        alignment=TA_CENTER,
        spaceAfter=10 * mm,
    ))
    styles["Heading1"].fontName = "Helvetica-Bold"
    styles["Heading1"].fontSize = 16
    styles["Heading1"].leading = 20
    styles["Heading1"].textColor = colors.HexColor("#173B8F")
    styles["Heading1"].spaceBefore = 4 * mm
    styles["Heading1"].spaceAfter = 3 * mm
    styles["BodyText"].fontName = "Helvetica"
    styles["BodyText"].fontSize = 10
    styles["BodyText"].leading = 14
    styles["BodyText"].textColor = colors.HexColor("#26334D")

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title="Wizmatch Staffing OS - Team SOP",
        author="Growth Escalators / Wizmatch",
    )

    story = [
        Spacer(1, 20 * mm),
        Paragraph("Wizmatch Staffing OS", styles["TitleWM"]),
        Paragraph("Team Standard Operating Procedure", ParagraphStyle(
            "SubtitleWM", parent=styles["Heading2"], alignment=TA_CENTER,
            textColor=colors.HexColor("#334155"), spaceAfter=8 * mm,
        )),
        Paragraph(
            "Demand discovery to POC verification, requirement delivery, candidate matching, "
            "submission, placement, invoice, and collection.",
            ParagraphStyle("CoverBody", parent=styles["BodyText"], alignment=TA_CENTER),
        ),
        Spacer(1, 18 * mm),
        Table([
            ["Production", "crm.growthescalators.com/wizmatch/dashboard"],
            ["Pilot users", "Jatin and Kanishk"],
            ["Core rule", "Record the truth and always date the next action"],
        ], colWidths=[36 * mm, 120 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E8EEFC")),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#173B8F")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ])),
        PageBreak(),
    ]

    section(story, styles, "1. Operating flow",
            "Use one traceable workflow. An imported job is a signal, not an accepted requirement.",
            "02-dashboard.png", [
                "Signal -> company -> verified POC -> accepted requirement.",
                "Reviewed candidate evidence -> match -> shortlist -> exact consent.",
                "Approved submission -> interview -> offer -> placement.",
                "Placement, invoice, and collection remain separate records.",
            ])

    section(story, styles, "2. Review demand signals",
            "Open Wizmatch -> Signals. Qualify only relevant public demand and reject stale, duplicate, "
            "non-technical, or commercially unsuitable signals.", "01-signals-provider-status.png", [
                "TheirStack runs Monday and Thursday with a capped cohort.",
                "ATS polls only approved company boards.",
                "X-Ray is requirement-first and remains off until a genuine reviewed requirement exists.",
                "A signal never becomes an accepted requirement automatically.",
            ])

    section(story, styles, "3. Verify the hiring POC",
            "Open Companies & Contacts. Research CRM relationships first, then company pages, public "
            "search, and finally manual research.", "04-companies-contacts.png", [
                "Record the named person, title, category, evidence URL, verification state, owner, and next action.",
                "Never guess an email or phone number.",
                "A generic careers inbox cannot be the primary source attribution.",
                "Keep Person A/SAP and Person B/Java histories separate.",
            ])

    story.append(PageBreak())
    section(story, styles, "4. Create and accept the requirement",
            "Open Requirements -> New Requirement. Ignore the retained ZZ AUDIT TEST production row; "
            "it is historical QA evidence.", "05-requirements.png", [
                "Require company, named POC, genuine channel, owner, recruiter, SLA, and dated next action.",
                "Review mandatory and preferred canonical skills before acceptance.",
                "Keep unknown facts unknown.",
                "Store original budget/rate, currency, and period when known.",
            ])

    section(story, styles, "5. Work the assigned queue",
            "Use My Work as the daily queue. If it is empty, correct assignment/readiness in Wizmatch "
            "instead of creating a parallel spreadsheet.", "03-my-work.png", [
                "Every active requirement has an owner, recruiter, stage, SLA, and dated next action.",
                "Close stale work with an explicit reason.",
                "Review overdue actions every morning and before end of day.",
            ])

    section(story, styles, "6. Review candidates and matching",
            "A discovered lead is not a verified candidate. Validate skills, experience, recency, evidence, "
            "location, availability, and commercial facts first.", "06-talent-matching.png", [
                "Review blockers before score.",
                "SAP ABAP, SAP FICO, Java, and JavaScript remain distinct.",
                "Choose Shortlist, Watch, or Reject and record a reason.",
                "A shortlist never creates consent or a submission.",
            ])

    story.append(PageBreak())
    section(story, styles, "7. Consent and delivery",
            "Obtain current, revocable consent for the exact requirement. Prepare a draft, obtain the "
            "required approval, and record delivery only after it actually occurs.", "07-submissions-delivery.png", [
                "No submission without exact-requirement consent.",
                "No duplicate active submission for the same candidate and requirement.",
                "Every interview and offer links to the exact submission.",
            ])

    section(story, styles, "8. Placement and commercial close",
            "Record permanent or contract economics. Keep placement, invoice, and collection as separate "
            "milestones.", "08-placements.png", [
                "Permanent: fee, replacement period, refund exposure.",
                "Contract: bill rate, loaded cost, currency, period, and gross margin.",
                "A sub-20% margin exception needs an explicit admin record.",
                "Never fabricate production interviews, offers, starts, invoices, or collections.",
            ])

    section(story, styles, "9. Analytics and readiness",
            "Use Analytics for conversion and economics. Use System when a module appears empty or "
            "unavailable.", "09-analytics.png", [
                "Track signal relevance, POC completion, accepted requirements, qualified candidates, and conversions.",
                "Track time to shortlist/fill, invoicing, collection, and margin.",
                "An empty funnel is not a software fault when no genuine records exist.",
            ])

    section(story, styles, "10. System checks",
            "System distinguishes technical readiness from missing operating data.", "10-system.png", [
                "Check schema, usable funnel, missing-data, provider, guardrail, and automation status.",
                "Use Retry for honest failure states; demo records must never replace failed live data.",
                "Sending and automatic submissions remain disabled.",
            ])

    story.append(PageBreak())
    story.append(Paragraph("11. Daily operating rhythm", styles["Heading1"]))
    daily = [
        ["Morning", "My Work; overdue actions; new TheirStack/ATS signals; POC assignments."],
        ["Midday", "Verify POCs; record coordination; create genuine requirements; complete skills and ownership."],
        ["Afternoon", "Review candidate evidence; decide matches; obtain consent; prepare submissions; update feedback."],
        ["End of day", "Date every next action; close stale work; review exceptions; reconcile commercial milestones."],
    ]
    story.append(Table(daily, colWidths=[32 * mm, 128 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E8EEFC")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#173B8F")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ])))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("12. Final checklist", styles["Heading1"]))
    story.extend(bullets([
        "Correct company and actual source POC.",
        "Genuine contact channel and verification evidence.",
        "Clear owner, recruiter, SLA, and dated next action.",
        "Canonical requirement skills and evidence-backed candidate facts.",
        "Exact consent, approved submission, and traceable delivery.",
        "Placement, invoice, and collection recorded separately.",
    ], styles))

    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Pilot targets", styles["Heading1"]))
    story.extend(bullets([
        "At least 80% relevance among the first 25 reviewed qualified TheirStack signals.",
        "100% of qualified signals have a POC state, owner, and next action.",
        "Named POC within 24 hours where public evidence exists.",
        "Genuine channel or explicit research blocker within 48 hours.",
        "At least four qualified candidates per workable requirement where supply exists.",
        "Zero automatic submissions and zero duplicate provider signals after reruns.",
    ], styles))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUTPUT)


if __name__ == "__main__":
    build()
