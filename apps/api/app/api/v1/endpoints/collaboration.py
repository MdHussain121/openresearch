import asyncio
import json
import logging
import os
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import anyio
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.models.document import Document
from app.models.user import User
from app.services.auth import (
    decode_token,
    get_current_user,
    get_or_create_local_user,
    verify_user_access_to_owner,
)

router = APIRouter()
logger = logging.getLogger("openresearch.collab")

WS_AUTH_TIMEOUT_SECONDS = 10.0
WS_MAX_FRAME_BYTES = 512 * 1024
WS_MAX_MESSAGES_PER_WINDOW = 120
WS_RATE_WINDOW_SECONDS = 10.0


def _persist_doc_edit(document_id: str, content_json: Any, plain_text: Any) -> bool:
    """Persist a collaborative edit to the document. Returns True on success."""
    own_session = SessionLocal()
    try:
        document = own_session.query(Document).filter(Document.id == document_id).first()
        if document is None:
            return False
        if isinstance(content_json, dict):
            document.content_json = content_json
        if isinstance(plain_text, str):
            document.plain_text = plain_text
        document.updated_at = datetime.now(UTC)
        if hasattr(document, "version") and getattr(document, "version", None) is not None:
            document.version = int(document.version) + 1
        own_session.commit()
        return True
    except Exception:
        own_session.rollback()
        logger.exception("Failed to persist collaborative edit for document %s", document_id)
        return False
    finally:
        own_session.close()


class CollaborationRoomManager:
    """
    Tracks presence per document room and fans out realtime events.

    Horizontal scaling: every outbound broadcast is also published to Redis on
    `collab:doc:{document_id}`; a per-process relay subscriber re-delivers
    messages originating from other workers to local sockets. Same-process
    duplicates are suppressed via a worker-origin tag.
    """

    def __init__(self):
        self.active_connections: dict[str, list[dict[str, Any]]] = {}
        self.worker_origin = str(uuid.uuid4())
        self.redis_client: Any | None = None
        self._relay_task: asyncio.Task[None] | None = None
        if getattr(settings, "REDIS_URL", None):
            try:
                import redis.asyncio as aioredis

                self.redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            except Exception:
                self.redis_client = None

    async def _ensure_relay(self) -> None:
        if self._relay_task is not None or self.redis_client is None:
            return
        self._relay_task = asyncio.create_task(self._relay_loop())

    async def _relay_loop(self) -> None:
        redis_client = self.redis_client
        if redis_client is None:
            return
        backoff = 1
        max_backoff = 30
        try:
            pubsub = redis_client.pubsub()
            await pubsub.psubscribe("collab:doc:*")
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                document_id = str(message.get("channel", "")).rsplit(":", 1)[-1]
                try:
                    envelope = json.loads(message.get("data") or "{}")
                except json.JSONDecodeError:
                    continue
                if envelope.get("origin") == self.worker_origin:
                    continue
                payload = envelope.get("msg", {})
                for conn in list(self.active_connections.get(document_id, [])):
                    try:
                        await conn["ws"].send_json(payload)
                    except Exception:
                        self.disconnect(conn["ws"], document_id)
            backoff = 1
        except asyncio.CancelledError:
            logger.info("Relay task cancelled")
        except Exception:
            logger.exception("Collaboration relay terminated unexpectedly")
            self._relay_task = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
            if self._relay_task is not None and not self._relay_task.done():
                self._relay_task.cancel()
                try:
                    await asyncio.wait_for(self._relay_task, timeout=1.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            self._relay_task = asyncio.create_task(self._relay_loop())

    async def connect(self, websocket: WebSocket, document_id: str, user_info: dict[str, Any]):
        if document_id not in self.active_connections:
            self.active_connections[document_id] = []
        self.active_connections[document_id].append(
            {"ws": websocket, "user": user_info, "joined_at": datetime.now(UTC).isoformat()}
        )
        await self._ensure_relay()
        await self.broadcast(
            document_id,
            {
                "type": "user_joined",
                "user": user_info,
                "active_users": self.get_room_users(document_id),
            },
            exclude_ws=websocket,
        )

    def disconnect(self, websocket: WebSocket, document_id: str):
        if document_id in self.active_connections:
            self.active_connections[document_id] = [
                conn for conn in self.active_connections[document_id] if conn["ws"] != websocket
            ]
            if not self.active_connections[document_id]:
                del self.active_connections[document_id]

    async def broadcast(
        self, document_id: str, message: dict[str, Any], exclude_ws: WebSocket | None = None
    ):
        if self.redis_client:
            try:
                await self._publish_async(document_id, message)
            except Exception:
                logger.debug("Redis broadcast failed for document %s", document_id, exc_info=True)

        if document_id in self.active_connections:
            for conn in list(self.active_connections[document_id]):
                if conn["ws"] != exclude_ws:
                    try:
                        await conn["ws"].send_json(message)
                    except Exception:
                        self.disconnect(conn["ws"], document_id)

    async def _publish_async(self, document_id: str, message: dict[str, Any]) -> None:
        if self.redis_client is None:
            return
        envelope = json.dumps({"origin": self.worker_origin, "msg": message})
        await self.redis_client.publish(f"collab:doc:{document_id}", envelope)

    def get_room_users(self, document_id: str) -> list[dict[str, Any]]:
        if document_id not in self.active_connections:
            return []
        return [conn["user"] for conn in self.active_connections[document_id]]


collab_manager = CollaborationRoomManager()


async def _authenticate_websocket(
    websocket: WebSocket, db: Session, document_id: str
) -> User | None:
    """
    First-message authentication: the client must send {"type": "auth", "token": "<JWT>"}
    as its very first frame. Keeps bearer tokens out of URLs (and out of proxy/access logs).
    """
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_AUTH_TIMEOUT_SECONDS)
        msg = json.loads(raw)
    except (TimeoutError, WebSocketDisconnect, json.JSONDecodeError, OSError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    if not isinstance(msg, dict) or msg.get("type") != "auth":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    token = msg.get("token")
    if not token:
        # Local single-user mode: an auth frame without a token joins as the local user.
        if not os.environ.get("OPENRESEARCH_DEV_INSECURE_AUTH", "").strip() == "1":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None
        user = get_or_create_local_user(db)
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document or not document.project:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None
        if not verify_user_access_to_owner(db, user.id, document.project.owner_id):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return None
        return user

    try:
        payload = decode_token(token, expected_type="access")
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("missing subject")
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    token_user = db.query(User).filter(User.id == user_id).first()
    if not token_user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    document = db.query(Document).filter(Document.id == document_id).first()
    if not document or not document.project:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    if not verify_user_access_to_owner(db, token_user.id, document.project.owner_id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    return token_user


@router.websocket("/ws/collaborate/{document_id}")
async def websocket_collaboration(
    websocket: WebSocket,
    document_id: str,
    db: Session = Depends(get_db),
) -> None:
    """
    Real-time collaboration WebSocket channel (Roadmap 9.2).
    Broadcasts multi-cursor positions, selections, and live edits across active
    collaborators and persists doc_edit payloads to the document record.

    Protocol: connect, then send {"type": "auth", "token": "<access JWT>"} as the
    first frame within 10s. In local single-user mode the token may be empty;
    project membership is always verified for the target document.

    The DB session is closed immediately after authentication to release the
    pool slot; subsequent DB writes use short-lived SessionLocal() scopes.
    """
    await websocket.accept()
    user = await _authenticate_websocket(websocket, db, document_id)
    user_id = user.id if user else None
    user_name = user.name if user else None
    user_email = user.email if user else None
    db.close()
    if user is None:
        return

    client_id = str(uuid.uuid4())
    user_info = {
        "client_id": client_id,
        "user_id": user_id,
        "name": user_name or "Collaborator",
        "email": user_email,
        "color": "#2C5F4A",
        "cursor": None,
    }

    await collab_manager.connect(websocket, document_id, user_info)
    try:
        await websocket.send_json(
            {
                "type": "room_state",
                "document_id": document_id,
                "active_users": collab_manager.get_room_users(document_id),
            }
        )

        send_timestamps: list[float] = []
        while True:
            data_text = await websocket.receive_text()
            if len(data_text) > WS_MAX_FRAME_BYTES:
                logger.warning(
                    "Dropping oversized collaboration frame (%d bytes) on document %s",
                    len(data_text),
                    document_id,
                )
                continue

            now = time.monotonic()
            send_timestamps = [t for t in send_timestamps if now - t < WS_RATE_WINDOW_SECONDS]
            if len(send_timestamps) >= WS_MAX_MESSAGES_PER_WINDOW:
                logger.warning(
                    "Rate limit exceeded on collaboration socket for document %s; closing",
                    document_id,
                )
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                break
            send_timestamps.append(now)

            try:
                msg = json.loads(data_text)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            if msg_type == "init_user":
                # Only display-level fields may be set by clients; identity is server-owned.
                client_updates = msg.get("user") or {}
                if isinstance(client_updates, dict):
                    for key in ("name", "color"):
                        if isinstance(client_updates.get(key), str):
                            user_info[key] = client_updates[key][:64]
                user_info["cursor"] = None
                await collab_manager.broadcast(
                    document_id,
                    {
                        "type": "presence_update",
                        "user": user_info,
                        "active_users": collab_manager.get_room_users(document_id),
                    },
                )
            elif msg_type == "cursor_move":
                cursor = msg.get("cursor")
                if not isinstance(cursor, dict):
                    cursor = None
                user_info["cursor"] = cursor
                await collab_manager.broadcast(
                    document_id,
                    {
                        "type": "cursor_update",
                        "client_id": user_info["client_id"],
                        "user": user_info,
                        "cursor": cursor,
                    },
                    exclude_ws=websocket,
                )
            elif msg_type == "doc_edit":
                content_json = msg.get("content_json")
                plain_text = msg.get("plain_text")
                persisted = await anyio.to_thread.run_sync(
                    _persist_doc_edit, document_id, content_json, plain_text
                )
                await collab_manager.broadcast(
                    document_id,
                    {
                        "type": "doc_edit_broadcast",
                        "client_id": user_info["client_id"],
                        "delta": msg.get("delta"),
                        "content_json": content_json,
                        "plain_text": plain_text,
                        "persisted": persisted,
                    },
                    exclude_ws=websocket,
                )
            elif msg_type == "comment_sync":
                await collab_manager.broadcast(
                    document_id,
                    {
                        "type": "comment_event",
                        "action": msg.get("action"),
                        "comment": msg.get("comment"),
                    },
                    exclude_ws=websocket,
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Unexpected error in collaboration socket for document %s", document_id)
    finally:
        collab_manager.disconnect(websocket, document_id)
        try:
            await collab_manager.broadcast(
                document_id,
                {
                    "type": "user_left",
                    "user": user_info,
                    "active_users": collab_manager.get_room_users(document_id),
                },
            )
        except Exception:
            pass


@router.get("/documents/{document_id}/collaborators")
def get_active_collaborators(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Returns the list of currently active collaborators in this document.
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document or not document.project:
        raise HTTPException(status_code=404, detail="Document not found")

    if not verify_user_access_to_owner(db, current_user.id, document.project.owner_id):
        raise HTTPException(status_code=403, detail="You do not have access to this document")

    users = collab_manager.get_room_users(document_id)
    return {"document_id": document_id, "collaborator_count": len(users), "collaborators": users}
