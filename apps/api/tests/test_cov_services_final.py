"""Coverage: core (config/database/middleware/main), text_utils, auth, llm,
collaboration, exporters, ast_parser, csl_formatter, and misc service arms."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import get_db
from app.core.middleware import GlobalErrorEnvelopeMiddleware
from app.core.text_utils import (
    format_authors_bibliography,
    format_authors_inline,
    format_authors_summary,
    format_inline_marker,
)
from app.main import app as main_app
from app.models.paper import Paper
from app.services.auth import LOCAL_USER_EMAIL, create_access_token, get_current_user
from app.services.export import (
    ExportOptions,
    ExportService,
    export_to_markdown,
    parse_document_blocks,
)
from app.services.export.csl_formatter import format_bibliography_entry
from app.services.export.csl_formatter import format_inline_marker as csl_inline
from app.services.identifier_resolver import identifier_resolver
from app.services.llm_service import LLMService

# ---------------------------------------------------------------------------
# core: config / database / middleware / main
# ---------------------------------------------------------------------------


def test_settings_cors_origin_validator_variants():
    s1 = Settings(_env_file=None, CORS_ORIGINS='["http://a.example", "http://b.example"]')
    assert s1.CORS_ORIGINS == ["http://a.example", "http://b.example"]

    s2 = Settings(_env_file=None, CORS_ORIGINS="http://c.example,http://d.example")
    assert s2.CORS_ORIGINS == ["http://c.example", "http://d.example"]

    # malformed JSON that looks like a JSON array raises ValueError (fail-fast)
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        Settings(_env_file=None, CORS_ORIGINS="[not-json]")


def test_get_db_yields_and_closes_session():
    from sqlalchemy import event, text

    from app.core import database as dbmod

    checked_in = []

    def on_checkin(dbapi_conn, record):
        checked_in.append(record)

    event.listen(dbmod.engine, "checkin", on_checkin)
    try:
        gen = get_db()
        session = next(gen)
        assert session is not None
        session.execute(text("SELECT 1"))  # force a real connection checkout
        before = len(checked_in)
        with pytest.raises(StopIteration):
            next(gen)
        # Generator exhaustion must run the finally-block close and release
        # the connection back to the pool.
        assert len(checked_in) > before
    finally:
        event.remove(dbmod.engine, "checkin", on_checkin)


def test_sqlite_pragma_listener_executes():
    from app.core import database as dbmod

    executed = []

    class FakeCursor:
        def execute(self, sql):
            executed.append(sql)

        def close(self):
            executed.append("closed")

    class FakeConn:
        def cursor(self):
            return FakeCursor()

    dbmod.set_sqlite_pragma(FakeConn(), None)
    assert any("journal_mode" in str(s) for s in executed)
    assert "closed" in executed


def test_error_envelope_middleware_returns_json_500():
    tiny = FastAPI()

    @tiny.get("/boom")
    async def boom():
        raise RuntimeError("kaput")

    tiny.add_middleware(GlobalErrorEnvelopeMiddleware)
    client = TestClient(tiny, raise_server_exceptions=False)
    resp = client.get("/boom")
    assert resp.status_code == 500
    body = resp.json()
    assert "error" in body or "message" in body


def test_run_migrations_all_branches(monkeypatch):
    from app import main as app_main

    calls = []
    monkeypatch.setattr(
        app_main.command, "upgrade", lambda cfg, rev: calls.append(("upgrade", rev))
    )
    monkeypatch.setattr(app_main.command, "stamp", lambda cfg, rev: calls.append(("stamp", rev)))

    # 1. tables exist WITH alembic_version -> upgrade head
    monkeypatch.setattr(
        app_main,
        "inspect",
        lambda eng: SimpleNamespace(get_table_names=lambda: ["alembic_version", "users"]),
    )
    app_main._run_migrations()
    assert ("upgrade", "head") in calls

    # 2. pre-Alembic tables -> stamp head
    calls.clear()
    monkeypatch.setattr(
        app_main, "inspect", lambda eng: SimpleNamespace(get_table_names=lambda: ["users"])
    )
    app_main._run_migrations()
    assert ("stamp", "head") in calls

    # 3. empty database -> upgrade head
    calls.clear()
    monkeypatch.setattr(
        app_main, "inspect", lambda eng: SimpleNamespace(get_table_names=lambda: [])
    )
    app_main._run_migrations()
    assert ("upgrade", "head") in calls

    # 4. missing alembic.ini -> RuntimeError
    orig_exists = __import__("pathlib").Path.exists

    def fake_exists(self):
        if str(self).endswith("alembic.ini"):
            return False
        return orig_exists(self)

    monkeypatch.setattr(__import__("pathlib").Path, "exists", fake_exists)
    with pytest.raises(RuntimeError):
        app_main._run_migrations()


def test_app_lifespan_runs_and_root_endpoint():
    with TestClient(main_app) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "message" in root.json()


# ---------------------------------------------------------------------------
# text_utils fallback arms
# ---------------------------------------------------------------------------


def test_text_utils_remaining_branches():
    # summary: plain-string authors, mixed junk, empties
    assert (
        format_authors_summary(["Alice Smith", {"familyName": "Hopper"}]) == "Alice Smith & Hopper"
    )
    assert format_authors_summary([42]) == "Unknown Author"
    assert format_authors_summary([]) == "Unknown Author"

    # bibliography inline: strings, non-dicts, literals, missing given
    assert "Str" in format_authors_inline(["Str Author"], "apa")
    assert format_authors_inline([{"literal": "Org"}], "vancouver") == "Org"
    assert format_authors_inline([{}], "ieee") == "Unknown"

    fam_only = [{"familyName": "Solo"}]
    assert format_authors_bibliography(fam_only, "harvard") == "Solo"

    many = [{"familyName": f"N{i}", "givenName": f"G{i}"} for i in range(8)]
    assert "et al." in format_authors_bibliography(many, "vancouver")
    assert "et al." in format_authors_bibliography(many, "ieee")
    twenty_two = [{"familyName": f"M{i}", "givenName": "X"} for i in range(22)]
    out22 = format_authors_bibliography(twenty_two, "apa")
    assert "..." in out22

    # inline marker: every style incl. fallbacks and page numbers
    ref_like = {"authors": [{"familyName": "Kim", "givenName": "Soo"}], "year": 2020}
    for style in ("apa", "mla", "chicago", "harvard", "vancouver", "turabian", "weird"):
        marker = format_inline_marker(ref_like["authors"], style, index=4, page_num=7)
        assert isinstance(marker, str) and marker


# ---------------------------------------------------------------------------
# models / auth / llm / resolver
# ---------------------------------------------------------------------------


def test_paper_primary_author_name_accepts_plain_strings():
    p = Paper(id="pp", project_id="pj", title="T", authors=["Plain Name"])
    assert p.primary_author_name == "Plain Name"


def test_auth_token_and_authentication_paths(db):
    tok = create_access_token({"sub": "abc"}, expires_delta=timedelta(minutes=-1))
    assert isinstance(tok, str)

    from app.services.auth import authenticate_user

    assert authenticate_user(db, "ghost@openresearch.org", "pw") is None
    created = __import__(
        "app.services.auth", fromlist=["create_user_with_personal_owner"]
    ).create_user_with_personal_owner(
        db, email="authpaths@openresearch.org", name="AP", password="goodpw123"
    )
    assert authenticate_user(db, created.email, "wrongpw") is None
    assert authenticate_user(db, created.email, "goodpw123") is not None

    # Local mode (DEV_INSECURE_AUTH): a garbage token falls back to the auto-provisioned local user
    bogus = SimpleNamespace(credentials="not-a-jwt")
    local_user = get_current_user(auth=bogus, db=db)
    assert local_user.email == LOCAL_USER_EMAIL

    # ...and so does a request without any credentials at all
    anon_user = get_current_user(auth=None, db=db)
    assert anon_user.id == local_user.id


def test_llm_service_probe_and_generate_paths(monkeypatch):
    svc = LLMService()
    svc._checked_at = 0.0

    # empty messages -> None without probing
    assert svc.generate([]) is None

    # probe failure path
    def boom_get(*a, **k):
        raise OSError("offline")

    monkeypatch.setattr(
        "app.services.llm_service.get_sync_http_client", lambda: SimpleNamespace(get=boom_get)
    )
    assert svc.generate([{"role": "user", "content": "hi"}]) is None
    assert svc._probe_availability() is False

    # successful generation
    svc._checked_at = 0.0
    fake = SimpleNamespace(
        get=lambda *a, **k: SimpleNamespace(status_code=200),
        post=lambda *a, **k: SimpleNamespace(
            status_code=200, json=lambda: {"message": {"content": "  answer  "}}
        ),
    )
    monkeypatch.setattr("app.services.llm_service.get_sync_http_client", lambda: fake)
    assert svc.generate([{"role": "user", "content": "hi"}]) == "answer"
    assert svc._probe_availability() is True

    # non-200 response
    bad = SimpleNamespace(
        get=lambda *a, **k: SimpleNamespace(status_code=200),
        post=lambda *a, **k: SimpleNamespace(status_code=500),
    )
    monkeypatch.setattr("app.services.llm_service.get_sync_http_client", lambda: bad)
    svc._available = True
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    # exception during post
    def raise_post(*a, **k):
        raise OSError("nope")

    bad2 = SimpleNamespace(get=lambda *a, **k: SimpleNamespace(status_code=200), post=raise_post)
    monkeypatch.setattr("app.services.llm_service.get_sync_http_client", lambda: bad2)
    svc._available = True
    assert svc.generate([{"role": "user", "content": "hi"}]) is None


def test_identifier_resolver_extra_arms():
    assert identifier_resolver.detect_identifier_type("pmid:12345678") == "pmid"
    assert identifier_resolver.detect_identifier_type("https://arxiv.org/abs/1706.03762") == "arxiv"


# ---------------------------------------------------------------------------
# collaboration manager + websocket flow
# ---------------------------------------------------------------------------


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, msg):
        self.sent.append(msg)


def test_collab_manager_unit_flow():
    from app.api.v1.endpoints.collaboration import collab_manager

    ws1, ws2 = FakeWebSocket(), FakeWebSocket()

    async def run():
        await collab_manager.connect(ws1, "doc-x", {"client_id": "c1"})
        await collab_manager.connect(ws2, "doc-x", {"client_id": "c2"})
        users = collab_manager.get_room_users("doc-x")
        assert len(users) == 2

        await collab_manager.broadcast("doc-x", {"type": "t"}, exclude_ws=ws1)
        assert {"type": "t"} in ws2.sent
        assert all(m["type"] == "user_joined" for m in ws1.sent)

        collab_manager.disconnect(ws1, "doc-x")
        collab_manager.disconnect(ws1, "doc-x")  # idempotent: duplicate disconnect is a no-op
        collab_manager.disconnect(ws2, "doc-x")  # last socket out triggers room cleanup
        assert "doc-x" not in collab_manager.active_connections
        assert collab_manager.get_room_users("doc-x") == []

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()


def test_collab_websocket_happy_and_unauthorized(client: TestClient, db: Session):
    headers = _reg(client, "ws_user@openresearch.org")
    proj = client.post("/api/v1/projects", json={"name": "WS"}, headers=headers).json()
    doc = client.post(
        "/api/v1/documents",
        json={"project_id": proj["id"], "title": "WS Doc"},
        headers=headers,
    ).json()

    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "ws_user@openresearch.org", "password": "Secure_Password_123"},
    )
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]

    # unauthorized: bad token -> server closes with policy-violation before joining the room
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/ws/collaborate/{doc['id']}") as ws:
            ws.send_json({"type": "auth", "token": "bad"})
            ws.receive_text()

    # happy path: authenticate first, exercise every message type then disconnect
    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc['id']}") as ws:
        ws.send_text(json_msg("auth", token=token))
        ws.receive_text()  # room_state frame
        ws.send_text("not-json-at-all")  # JSONDecodeError continue branch
        ws.send_text(json_msg("init_user", user={"name": "WSU", "color": "red"}))
        ws.send_text(json_msg("cursor_move", cursor={"line": 1, "ch": 2}))
        ws.send_text(json_msg("doc_edit", delta={"x": 1}, content_json={}, plain_text=""))
        ws.send_text(json_msg("comment_sync", action="created", comment={"id": "z"}))
        ws.send_text(json_msg("unknown_type"))

    collaborators = client.get(f"/api/v1/documents/{doc['id']}/collaborators", headers=headers)
    assert collaborators.status_code == 200
    assert collaborators.json()["collaborator_count"] >= 0


def json_msg(type_, **extra):
    import json as _j

    payload = {"type": type_}
    payload.update(extra)
    return _j.dumps(payload)


def _reg(client, email):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secure_Password_123", "name": email},
    )
    return {"Authorization": "Bearer " + r.json()["access_token"]}


# ---------------------------------------------------------------------------
# exporters / csl_formatter / export service
# ---------------------------------------------------------------------------


def _doc_paper_pair():
    from app.models.document import Document

    doc = Document(
        id="cov-exp-doc",
        project_id="cov-exp-proj",
        title="Export Coverage",
        content_json={
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 4},
                    "content": [{"type": "text", "text": "Deep H"}],
                },
                {"type": "paragraph", "content": [{"type": "text", "text": "Body text here."}]},
                {"type": "blockquote", "content": [{"type": "text", "text": "Quote"}]},
                {"type": "codeBlock", "content": [{"type": "text", "text": "print(1)"}]},
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": "b1"}]}
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
                                {"type": "paragraph", "content": [{"type": "text", "text": "s1"}]}
                            ],
                        }
                    ],
                },
                {"type": "table", "content": []},
                {"type": "mathEquation", "attrs": {"latex": "E=mc^2"}},
            ],
        },
        plain_text="Body text here.",
    )
    paper = Paper(
        id="cov-exp-p",
        project_id="cov-exp-proj",
        title="A Paper",
        authors=[{"familyName": "One", "givenName": "A"}, {"literal": "OrgTwo"}],
        year=2021,
        doi="10.1/z",
        arxiv_id="2101.0001",
        pmid="123",
        abstract="Abs.",
        metadata_json={
            "journal": "J",
            "volume": "1",
            "issue": "2",
            "pages": "3-4",
            "publisher": "P",
        },
    )
    return doc, paper


def test_export_matrix_options_and_formats():
    doc, paper = _doc_paper_pair()

    for fmt in ("markdown", "docx", "pdf", "bibtex"):
        buf, fn, mime = ExportService.export_document(
            document=doc,
            citations=[],
            papers=[paper],
            options=ExportOptions(export_format=fmt, citation_style="chicago-notes"),
        )
        content = buf.getvalue() if hasattr(buf, "getvalue") else str(buf).encode()
        assert len(content) > 0

    md_off, _, _ = ExportService.export_document(
        document=doc,
        citations=[],
        papers=[paper],
        options=ExportOptions(
            export_format="markdown", include_trust_markers=False, include_bibliography=False
        ),
    )
    assert md_off.startswith("# Export Coverage")
    assert "#### Deep H" in md_off
    assert "Body text here." in md_off
    assert "References" not in md_off

    # markdown direct-call with trust markers ON and citations present
    from app.models.citation import Citation

    cit = Citation(
        id="cx",
        document_id=doc.id,
        paper_id=paper.id,
        position=1,
        citation_style="apa",
        attribution_scope="sentence",
    )
    md_on = export_to_markdown(doc, [cit], [paper])
    assert "References" in md_on or "@" in md_on


def test_csl_formatter_every_style_body():
    ref = Paper(
        id="csl-p",
        project_id="p",
        title="Styled Entry",
        year=2022,
        doi="10.2/s",
        abstract=None,
        metadata_json={"journal": "Venue J", "volume": "9", "issue": "1", "pages": "10-20"},
    )
    for style in (
        "apa",
        "mla",
        "chicago",
        "ieee",
        "harvard",
        "vancouver",
        "nature",
        "science",
        "acm",
        "acs",
        "chicago-notes",
        "turabian",
        "other",
    ):
        entry = format_bibliography_entry(ref, style, index=2)
        assert entry
        marker = csl_inline(ref, style, index=2, page_num=3)
        assert isinstance(marker, str)

    # no-journal fallback venue chain
    bare = Paper(id="csl-b", project_id="p", title="No Venue", authors=[{"familyName": "X"}])
    assert "X" in format_bibliography_entry(bare, "apa")


def test_parse_document_blocks_unknown_node_and_marks():
    doc, _ = _doc_paper_pair()
    doc.content_json = {
        "type": "doc",
        "content": [
            {
                "type": "mysteryNode",
                "attrs": {},
                "content": [
                    {
                        "type": "text",
                        "text": "?",
                        "marks": [{"type": "claimVerification", "attrs": {"claimId": "c"}}],
                    }
                ],
            },
            {"type": "paragraph"},
            {"type": "heading", "attrs": {"level": 9}},
        ],
    }
    blocks = parse_document_blocks(doc, {}, "apa")
    assert isinstance(blocks, list)


def test_export_service_unknown_format_raises_instead_of_falling_back():
    doc, paper = _doc_paper_pair()
    with pytest.raises(ValueError, match="Unsupported export format"):
        ExportService.export_document(
            document=doc,
            citations=[],
            papers=[paper],
            options=ExportOptions(export_format="epub"),
        )


# ---------------------------------------------------------------------------
# provider cache / http client leftovers
# ---------------------------------------------------------------------------


def test_provider_cache_redis_publish_failure_swallowed(monkeypatch):
    from app.services.provider_cache_service import provider_cache_service

    async def broken_publish(*a, **k):
        raise OSError("redis down")

    provider_cache_service.redis_client = SimpleNamespace(publish=broken_publish)
    provider_cache_service.clear()
    provider_cache_service.redis_client = None
