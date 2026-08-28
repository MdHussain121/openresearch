"""Comprehensive tests for collaboration endpoints, WebSocket room manager, and persistence."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.api.v1.endpoints.collaboration import (
    CollaborationRoomManager,
    _persist_doc_edit,
)
from app.models.document import Document
from app.models.project import Project
from app.services.auth import create_access_token, create_user_with_personal_owner


def _create_test_doc(db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="collab_user@example.com",
        password="Password123",
        name="Collab User",
    )
    proj = Project(
        name="Collab Project",
        owner_id=user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    doc = Document(
        project_id=proj.id,
        title="Collab Doc",
        content_json={"type": "doc", "content": []},
        plain_text="Initial text",
        version=1,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return user, proj, doc


def test_persist_doc_edit_success_and_failure(db: Session):
    user, proj, doc = _create_test_doc(db)
    bind_engine = db.get_bind()
    custom_session_maker = sessionmaker(autocommit=False, autoflush=False, bind=bind_engine)

    with patch("app.api.v1.endpoints.collaboration.SessionLocal", custom_session_maker):
        success = _persist_doc_edit(
            document_id=doc.id,
            content_json={"type": "doc", "content": [{"type": "paragraph"}]},
            plain_text="Updated text",
        )
        assert success is True

        check_sess = custom_session_maker()
        try:
            updated_doc = check_sess.query(Document).filter(Document.id == doc.id).first()
            assert updated_doc is not None
            assert updated_doc.plain_text == "Updated text"
            assert updated_doc.version == 2
        finally:
            check_sess.close()

        # 2. Document does not exist -> returns False
        assert _persist_doc_edit("non-existent-doc-id", {}, "text") is False


def test_collaboration_room_manager_unit():
    mgr = CollaborationRoomManager()
    mgr.redis_client = None  # disable redis for local unit tests

    ws1 = MagicMock()
    ws1.send_json = AsyncMock()

    ws2 = MagicMock()
    ws2.send_json = AsyncMock()

    user1 = {"client_id": "c1", "name": "User 1", "color": "#111"}
    user2 = {"client_id": "c2", "name": "User 2", "color": "#222"}

    # 1. Connect ws1 and ws2
    asyncio.run(mgr.connect(ws1, "doc-1", user1))
    asyncio.run(mgr.connect(ws2, "doc-1", user2))

    users = mgr.get_room_users("doc-1")
    assert len(users) == 2
    assert mgr.get_room_users("empty-doc") == []

    # 2. Broadcast to room excluding ws1
    asyncio.run(mgr.broadcast("doc-1", {"type": "test_event"}, exclude_ws=ws1))
    ws2.send_json.assert_called_with({"type": "test_event"})

    # 3. Disconnect ws1
    mgr.disconnect(ws1, "doc-1")
    assert len(mgr.get_room_users("doc-1")) == 1

    # 4. Disconnect ws2 -> room emptied
    mgr.disconnect(ws2, "doc-1")
    assert mgr.get_room_users("doc-1") == []


def test_collaboration_get_active_collaborators_api(client: TestClient, db: Session):
    user, proj, doc = _create_test_doc(db)
    token = create_access_token({"sub": user.id, "email": user.email})

    resp = client.get(
        f"/api/v1/documents/{doc.id}/collaborators",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["document_id"] == doc.id
    assert "collaborator_count" in data
    assert isinstance(data["collaborators"], list)


def test_collaboration_websocket_flow(client: TestClient, db: Session):
    user, proj, doc = _create_test_doc(db)
    token = create_access_token({"sub": user.id, "email": user.email})

    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc.id}") as ws:
        # Send auth frame
        ws.send_json({"type": "auth", "token": token})

        # Receive room_state frame
        state_msg = ws.receive_json()
        assert state_msg["type"] == "room_state"
        assert state_msg["document_id"] == doc.id

        # Send cursor_move frame
        ws.send_json({
            "type": "cursor_move",
            "cursor": {"from": 5, "to": 10}
        })

        # Send doc_edit frame
        ws.send_json({
            "type": "doc_edit",
            "content_json": {"type": "doc", "content": [{"type": "paragraph"}]},
            "plain_text": "Live collaboration edit",
            "delta": {}
        })

        # Send comment_sync frame
        ws.send_json({
            "type": "comment_sync",
            "action": "create",
            "comment": {"id": "c1", "content": "Live comment"}
        })

        # Send malformed frame (should not crash socket)
        ws.send_text("not-a-json-payload")
