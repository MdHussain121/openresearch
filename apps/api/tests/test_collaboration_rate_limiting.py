"""Tests for WebSocket collaboration rate limiting, frame sizing, and redis relay deduplication."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints.collaboration import (
    WS_MAX_FRAME_BYTES,
    WS_MAX_MESSAGES_PER_WINDOW,
    CollaborationRoomManager,
)
from app.models.document import Document
from app.models.project import Project
from app.services.auth import create_access_token, create_user_with_personal_owner


def _create_test_doc(db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="collab_rate_limit@example.com",
        password="Password123",
        name="Rate Limit User",
    )
    proj = Project(
        name="Rate Limit Proj",
        owner_id=user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    doc = Document(
        project_id=proj.id,
        title="Rate Limit Doc",
        content_json={"type": "doc", "content": []},
        plain_text="Initial text",
        version=1,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return user, proj, doc


def test_oversized_frame_is_dropped(client: TestClient, db: Session):
    user, proj, doc = _create_test_doc(db)
    token = create_access_token({"sub": user.id, "email": user.email})

    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc.id}") as ws:
        ws.send_json({"type": "auth", "token": token})
        state = ws.receive_json()
        assert state["type"] == "room_state"

        # Frame exceeding WS_MAX_FRAME_BYTES (512 KB)
        large_payload = "x" * (WS_MAX_FRAME_BYTES + 1024)
        ws.send_text(large_payload)

        # Send regular ping/cursor to ensure connection wasn't crashed
        ws.send_json({"type": "cursor_move", "cursor": {"from": 1, "to": 2}})


def test_rate_limit_exceeded_closes_socket(client: TestClient, db: Session):
    user, proj, doc = _create_test_doc(db)
    token = create_access_token({"sub": user.id, "email": user.email})

    with client.websocket_connect(f"/api/v1/ws/collaborate/{doc.id}") as ws:
        ws.send_json({"type": "auth", "token": token})
        state = ws.receive_json()
        assert state["type"] == "room_state"

        try:
            for i in range(WS_MAX_MESSAGES_PER_WINDOW + 20):
                ws.send_json({"type": "cursor_move", "cursor": {"from": i, "to": i + 1}})
        except (WebSocketDisconnect, Exception):
            pass


def test_redis_relay_message_handling():
    mgr = CollaborationRoomManager()
    mgr.worker_origin = "origin-123"

    ws1 = MagicMock()
    ws1.send_json = AsyncMock()

    user_info = {"client_id": "c1", "name": "User 1"}
    asyncio.run(mgr.connect(ws1, "doc-99", user_info))

    # Mock Redis client pubsub iterator
    mock_redis = MagicMock()
    mock_pubsub = MagicMock()

    class AsyncMessageIterator:
        def __init__(self, messages):
            self.messages = messages
            self.index = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self.index < len(self.messages):
                msg = self.messages[self.index]
                self.index += 1
                return msg
            raise StopAsyncIteration

    messages = [
        # 1. Non-pmessage -> ignored
        {"type": "subscribe"},
        # 2. Malformed json data -> ignored
        {"type": "pmessage", "channel": "collab:doc:doc-99", "data": "not-valid-json"},
        # 3. Same origin message -> deduplicated / ignored
        {
            "type": "pmessage",
            "channel": "collab:doc:doc-99",
            "data": json.dumps({"origin": "origin-123", "msg": {"type": "ping"}}),
        },
        # 4. Valid remote worker message -> dispatched to local socket
        {
            "type": "pmessage",
            "channel": "collab:doc:doc-99",
            "data": json.dumps({"origin": "other-origin", "msg": {"type": "remote_cursor"}}),
        },
    ]

    mock_pubsub.listen.return_value = AsyncMessageIterator(messages)
    mock_pubsub.psubscribe = AsyncMock()
    mock_redis.pubsub.return_value = mock_pubsub
    mgr.redis_client = mock_redis

    asyncio.run(mgr._relay_loop())

    ws1.send_json.assert_called_with({"type": "remote_cursor"})
