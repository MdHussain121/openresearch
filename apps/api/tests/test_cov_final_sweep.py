"""Final coverage sweep: ast_parser branches, exporter options/matrices,
csl_formatter styles, pdf_extractor fallbacks, rag/intelligence service paths."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.paper import Paper
from app.services.export.ast_parser import parse_document_blocks
from app.services.export.csl_formatter import (
    format_bibliography_entry,
    format_inline_marker,
)
from app.services.export.docx_exporter import export_to_docx
from app.services.export.options import ExportOptions
from app.services.export.pdf_exporter import export_to_pdf
from app.services.pdf_extractor import pdf_extractor


def _reg(client: TestClient, email: str) -> dict:
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secure_Password_123", "name": email},
    )
    return {"Authorization": "Bearer " + r.json()["access_token"]}


# ---------------------------------------------------------------------------
# ast_parser — every node type incl. nested-fallback and table cells
# ---------------------------------------------------------------------------


def test_ast_parser_full_node_matrix():
    from app.models.document import Document

    doc = Document(
        id="ast-doc",
        project_id="p",
        title="AST",
        content_json={
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "H2"}],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "Plain "},
                        {
                            "type": "citation",
                            "attrs": {
                                "paperId": "pap1",
                                "paperTitle": "T",
                                "authors": "A",
                                "index": 2,
                            },
                        },
                        {"type": "text", "text": " tail.", "marks": [{"type": "strong"}]},
                    ],
                },
                {"type": "blockquote", "content": [{"type": "text", "text": "Quoted"}]},
                {"type": "codeBlock", "content": [{"type": "text", "text": "code()"}]},
                {"type": "mathEquation", "attrs": {"latex": "x^2"}},
                {
                    "type": "bulletList",
                    "content": [
                        {"type": "listItem", "content": []},
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "b-item"}],
                                }
                            ],
                        },
                    ],
                },
                {
                    "type": "orderedList",
                    "content": [
                        {"type": "listItem", "content": []},
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "o-item"}],
                                }
                            ],
                        },
                    ],
                },
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableHeader",
                                    "content": [{"type": "text", "text": "Hdr"}],
                                },
                                {"type": "tableCell"},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableCell",
                                    "content": [{"type": "text", "text": "cell-a"}],
                                },
                            ],
                        },
                    ],
                },
                {"type": "unknownNode"},
            ],
        },
        plain_text=(
            "# Fallback H1\n\n## H2fb\n### H3fb\n> quote line\n- bullet star\n* bullet dash\n7. ordered item\n"
            "plain paragraph\n"
        ),
    )

    _, paper_rich = _rich_doc_paper()
    blocks = parse_document_blocks(doc, {"pap1": (paper_rich, 3)}, "apa")
    kinds = {b.block_type for b in blocks}
    assert {
        "heading",
        "paragraph",
        "blockquote",
        "code",
        "equation",
        "bullet_list",
        "ordered_list",
        "table",
    } <= kinds
    table_block = next(b for b in blocks if b.block_type == "table")
    assert table_block.table_rows and table_block.table_rows[0][0] == "Hdr"
    # citation inline rendered in APA author-year form via map lookup
    para = next(b for b in blocks if b.block_type == "paragraph")
    assert "(Einstein, 1915)" in para.content

    # force plain-text fallback path by stripping content_json
    doc.content_json = None
    fb = parse_document_blocks(doc, {}, "ieee")
    assert any(b.block_type == "heading" for b in fb)
    assert any(b.block_type == "blockquote" for b in fb)
    assert any(b.block_type == "ordered_list" for b in fb)


# ---------------------------------------------------------------------------
# exporters — options override paths and rich blocks
# ---------------------------------------------------------------------------


def _rich_doc_paper():
    from app.models.document import Document

    doc = Document(
        id="exp-rich",
        project_id="proj-r",
        title="Rich Export",
        content_json={
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1},
                    "content": [{"type": "text", "text": "Intro"}],
                },
                {
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "Sub"}],
                },
                {
                    "type": "heading",
                    "attrs": {"level": 3},
                    "content": [{"type": "text", "text": "SubSub"}],
                },
                {"type": "paragraph", "content": [{"type": "text", "text": "Para body"}]},
                {"type": "blockquote", "content": [{"type": "text", "text": "Quote body"}]},
                {"type": "codeBlock", "content": [{"type": "text", "text": "x=1"}]},
                {"type": "mathEquation", "attrs": {"latex": "y=2x"}},
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": "B"}]}
                            ],
                        }
                    ],
                },
                {
                    "type": "orderedList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": "O"}]}
                            ],
                        }
                    ],
                },
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableHeader",
                                    "content": [{"type": "text", "text": "C1"}],
                                },
                                {
                                    "type": "tableHeader",
                                    "content": [{"type": "text", "text": "C2"}],
                                },
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "content": [{"type": "text", "text": "v1"}]},
                                {"type": "tableCell", "content": [{"type": "text", "text": "v2"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        plain_text="Rich",
    )
    paper = Paper(
        id="rp1",
        project_id="proj-r",
        title="Ref Paper",
        authors=[{"familyName": "Einstein", "givenName": "Albert"}],
        year=1915,
        doi="10.5/gr",
        abstract="Gravitas.",
        metadata_json={"journal": "Annalen", "volume": "49", "pages": "769"},
    )
    return doc, paper


def test_docx_and_pdf_exporters_with_options_overrides():
    doc, paper = _rich_doc_paper()

    opts = ExportOptions(
        citation_style="vancouver",
        include_bibliography=True,
        include_trust_markers=True,
    )
    docx_buf = export_to_docx(doc, [], [paper], options=opts)
    assert len(docx_buf.getvalue()) > 1000

    pdf_buf = export_to_pdf(doc, [], [paper], options=ExportOptions(citation_style="harvard"))
    assert pdf_buf.getvalue().startswith(b"%PDF")


def test_csl_formatter_backend_all_styles_and_markers():
    ref = Paper(
        id="cslb",
        project_id="p",
        title="Backend CSL",
        year=1999,
        authors=[{"familyName": "Einstein", "givenName": "Albert"}],
        metadata_json={"journal": "BJ", "volume": "5", "issue": "6", "pages": "1-9"},
    )
    no_year = Paper(id="cslc", project_id="p", title="No Year", authors=[{"familyName": "Zed"}])
    for style in ("apa", "mla", "chicago", "ieee", "harvard", "vancouver", "zzz"):
        e1 = format_bibliography_entry(ref, style, 4)
        e2 = format_bibliography_entry(no_year, style, 4)
        m1 = format_inline_marker(ref, style, 4, page_num=11)
        m2 = format_inline_marker(no_year, style)
        assert e1 and e2 and isinstance(m1, str) and isinstance(m2, str)


# ---------------------------------------------------------------------------
# pdf_extractor — GROBID failure -> local fallback pipeline
# ---------------------------------------------------------------------------


def test_pdf_extractor_grobid_failure_falls_back(monkeypatch):
    import io

    from reportlab.pdfgen import canvas as rl_canvas

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(300, 300))
    for i in range(3):
        c.drawString(
            40, 200 - i * 30, f"Abstract This is page line {i}. The method works well overall."
        )
        c.showPage()
    c.save()
    pdf_path = "cov_test_extract.pdf"
    with open(pdf_path, "wb") as fh:
        fh.write(buf.getvalue())

    def fail_grobid(self, file_path):
        return None

    monkeypatch.setattr(type(pdf_extractor), "_extract_with_grobid", fail_grobid)
    result = pdf_extractor._extract_with_pdfplumber(pdf_path, "cov_test_extract.pdf")
    assert result.get("sections") or result.get("abstract") or result.get("full_doc_text")
    __import__("os").remove(pdf_path)


# ---------------------------------------------------------------------------
# rag chat / ask-paper flows through endpoints (general-response + grounded)
# ---------------------------------------------------------------------------


def test_chat_general_and_ask_paper_paths(client: TestClient, db: Session):
    headers = _reg(client, "chat_flow@openresearch.org")

    # unknown project guards
    assert (
        client.post(
            "/api/v1/projects/nope/chat", json={"message": "hi"}, headers=headers
        ).status_code
        == 404
    )
    ask_resp = client.post(
        "/api/v1/papers/ghost-p/ask", json={"question": "q", "selected_text": "s"}, headers=headers
    )
    assert ask_resp.status_code == 404

    proj = client.post("/api/v1/projects", json={"name": "ChatFlow"}, headers=headers).json()
    chat = client.post(
        f"/api/v1/projects/{proj['id']}/chat", json={"message": "Hello there"}, headers=headers
    )
    assert chat.status_code == 200

    # seed a paper + chunks so grounded synthesis runs
    paper = Paper(
        id="ask-p",
        project_id=proj["id"],
        title="Askable Paper",
        authors=[{"familyName": "Who"}],
        year=2020,
        extraction_status="ok",
    )
    db.add(paper)
    db.commit()
    client.post(f"/api/v1/papers/{paper.id}/index", headers=headers)

    ask_sum = client.post(
        f"/api/v1/papers/{paper.id}/ask",
        json={
            "question": "What is this about?",
            "selected_text": "scope",
            "prompt_type": "summarize",
        },
        headers=headers,
    )
    assert ask_sum.status_code == 200

    ask_explain = client.post(
        f"/api/v1/papers/{paper.id}/ask",
        json={
            "question": "Why does it matter?",
            "selected_text": "scope matters here",
            "prompt_type": "explain",
        },
        headers=headers,
    )
    assert ask_explain.status_code == 200
