"""
LLM integration for OpenResearch.

Provider order:
1. A locally configured cloud provider (API key saved via Settings > AI Providers,
   stored by app.services.provider_settings).
2. Local Ollama.

Tabby (keyless local server) is exposed separately via generate_tabby() and used
only for inline autocomplete; it never serves chat/edit/outline traffic.

Honest failure semantics: callers receive None whenever no provider is reachable
or a call errors, and must fall back to deterministic behavior instead of
fabricating output.
"""

import json
import logging
import threading
import time
from collections import deque
from collections.abc import Iterator
from typing import Any

import httpx

from app.core.config import settings
from app.core.http_client import get_sync_http_client
from app.services import provider_settings

logger = logging.getLogger("openresearch.llm")

_AVAILABILITY_TTL_SECONDS = 30.0

# Sliding-window length for user-configured cloud rate limits.
_RATE_LIMIT_WINDOW_SECONDS = 60.0


class LLMService:
    def __init__(self) -> None:
        self._available: bool | None = None
        self._checked_at: float = 0.0
        self._tabby_available: bool | None = None
        self._tabby_checked_at: float = 0.0
        self._tabby_probe_url: str = ""
        self._rate_lock = threading.Lock()
        self._rate_hits: dict[str, deque] = {}
        self._http_semaphore = threading.Semaphore(10)

    # ------------------------------------------------------- Rate limiting
    def _check_rate_limit(self, rpm: int | None) -> bool:
        """Records a shared cloud request slot; returns False when the configured RPM cap is exhausted."""
        if not rpm or rpm <= 0:
            return True
        now = time.monotonic()
        with self._rate_lock:
            hits = self._rate_hits.setdefault("cloud", deque())
            while hits and now - hits[0] > _RATE_LIMIT_WINDOW_SECONDS:
                hits.popleft()
            if len(hits) >= rpm:
                retry_after = max(int(_RATE_LIMIT_WINDOW_SECONDS - (now - hits[0])) + 1, 1)
                logger.warning(
                    "Global cloud rate limit reached (%s req/min); falling back for %ss",
                    rpm,
                    retry_after,
                )
                return False
            hits.append(now)
            return True

    # ------------------------------------------------------------------ Ollama
    def _probe_availability(self) -> bool:
        now = time.monotonic()
        if self._available is not None and (now - self._checked_at) < _AVAILABILITY_TTL_SECONDS:
            return self._available
        try:
            with self._http_semaphore:
                client = get_sync_http_client()
                resp = client.get(f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags", timeout=2.0)
            self._available = resp.status_code == 200
        except Exception as exc:
            logger.warning("Ollama probe failed: %s", exc)
            self._available = False
        self._checked_at = now
        if not self._available:
            logger.info(
                "Ollama unreachable at %s (model=%s); using deterministic fallback generation",
                settings.OLLAMA_BASE_URL,
                settings.OLLAMA_MODEL,
            )
        return self._available

    def _generate_ollama(
        self,
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> str | None:
        if not self._probe_availability():
            return None

        payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        try:
            with self._http_semaphore:
                client = get_sync_http_client()
                resp = client.post(
                    f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                    json=payload,
                    timeout=timeout_seconds or settings.LLM_TIMEOUT_SECONDS,
                )
            if resp.status_code != 200:
                logger.warning("Ollama returned status %s", resp.status_code)
                self._available = False
                self._checked_at = time.monotonic()
                return None
            content = resp.json().get("message", {}).get("content")
            return content.strip() if isinstance(content, str) and content.strip() else None
        except Exception as exc:
            logger.warning("Ollama generation failed: %s", exc)
            self._available = False
            self._checked_at = time.monotonic()
            return None

    # ------------------------------------------------ Tabby (autocomplete only)
    def _tabby_target(self) -> tuple[str, str]:
        """Effective (base_url, model) for Tabby, honoring locally saved settings."""
        ac = provider_settings.get_autocomplete_settings()
        base_url = (ac.get("base_url") or settings.TABBY_BASE_URL or "").rstrip("/")
        model = ac.get("model") or settings.TABBY_MODEL
        return base_url, model

    def probe_tabby(self, force: bool = False) -> bool:
        """Health-checks the local Tabby server (/v1/health), cached for 30s like Ollama."""
        base_url, _ = self._tabby_target()
        now = time.monotonic()
        if (
            not force
            and self._tabby_available is not None
            and (now - self._tabby_checked_at) < _AVAILABILITY_TTL_SECONDS
            and self._tabby_probe_url == base_url
        ):
            return self._tabby_available
        try:
            with self._http_semaphore:
                client = get_sync_http_client()
                resp = client.get(f"{base_url}/v1/health", timeout=2.0)
            self._tabby_available = resp.status_code == 200
        except Exception as exc:
            logger.warning("Tabby probe failed: %s", exc)
            self._tabby_available = False
        self._tabby_checked_at = now
        self._tabby_probe_url = base_url
        if not self._tabby_available:
            logger.info(
                "Tabby unreachable at %s; autocomplete falls back to cloud/Ollama", base_url
            )
        return self._tabby_available

    @staticmethod
    def build_completion_payload(prefix: str, suffix: str) -> dict[str, Any]:
        """
        Tabby's /v1/completions body (its own schema, not OpenAI): prefix/suffix
        go into `segments` and Tabby builds the FIM prompt server-side.
        """
        payload: dict[str, Any] = {
            "temperature": 0.2,
            "segments": {"prefix": prefix},
        }
        if suffix:
            payload["segments"]["suffix"] = suffix
        return payload

    def generate_tabby(
        self,
        prefix: str,
        suffix: str = "",
        max_tokens: int = 32,
        timeout_seconds: float = 3.0,
    ) -> str | None:
        """
        One-shot completion from the local Tabby server. Returns None when Tabby
        is unreachable or errors; never raises. Used exclusively by the
        autocomplete path. `max_tokens` is accepted for interface compatibility;
        Tabby manages its own generation budget.
        """
        if not prefix:
            return None
        base_url, _model = self._tabby_target()
        if not self.probe_tabby():
            return None

        try:
            with self._http_semaphore:
                client = get_sync_http_client()
                resp = client.post(
                    f"{base_url}/v1/completions",
                    json=self.build_completion_payload(prefix, suffix),
                    timeout=timeout_seconds,
                )
            if resp.status_code != 200:
                logger.warning("Tabby returned status %s", resp.status_code)
                self._tabby_available = False
                self._tabby_checked_at = time.monotonic()
                return None
            choices = resp.json().get("choices") or []
            if not choices:
                return None
            text = choices[0].get("text")
            if not isinstance(text, str):
                return None
            cleaned = text.replace("<|fim_middle|>", "").replace("<|endoftext|>", "").strip()
            return cleaned or None
        except Exception as exc:
            logger.warning("Tabby generation failed: %s", exc)
            self._tabby_available = False
            self._tabby_checked_at = time.monotonic()
            return None

    # ------------------------------------------------------- Cloud providers
    def _generate_cloud(
        self,
        creds: dict[str, Any],
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> str | None:
        if not self._check_rate_limit(provider_settings.get_global_rate_limit()):
            return None
        try:
            if creds["provider"] == "anthropic":
                return self._generate_anthropic(creds, messages, timeout_seconds, temperature)
            return self._generate_openai_compatible(creds, messages, timeout_seconds, temperature)
        except Exception as exc:
            logger.warning("Cloud provider '%s' generation failed: %s", creds["provider"], exc)
            return None

    def _generate_openai_compatible(
        self,
        creds: dict[str, Any],
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> str | None:
        base_url = (creds.get("base_url") or "").rstrip("/")
        if not base_url:
            logger.warning("OpenAI-compatible provider has no base URL configured")
            return None
        payload = {
            "model": creds.get("model"),
            "messages": messages,
            "temperature": temperature,
        }
        with self._http_semaphore:
            client = get_sync_http_client()
            resp = client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {creds['api_key']}",
                    "Content-Type": "application/json",
                },
                timeout=timeout_seconds or settings.LLM_TIMEOUT_SECONDS,
            )
        if resp.status_code != 200:
            logger.warning("OpenAI-compatible provider returned status %s", resp.status_code)
            return None
        choices = resp.json().get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message") or {}).get("content")
        return content.strip() if isinstance(content, str) and content.strip() else None

    def _generate_anthropic(
        self,
        creds: dict[str, Any],
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> str | None:
        base_url = (creds.get("base_url") or "https://api.anthropic.com").rstrip("/")
        system_text = "\n".join(m["content"] for m in messages if m.get("role") == "system")
        chat_messages = [m for m in messages if m.get("role") != "system"]
        payload: dict[str, Any] = {
            "model": creds.get("model"),
            "max_tokens": settings.LLM_MAX_TOKENS,
            "temperature": temperature,
            "messages": chat_messages,
        }
        if system_text:
            payload["system"] = system_text
        with self._http_semaphore:
            client = get_sync_http_client()
            resp = client.post(
                f"{base_url}/v1/messages",
                json=payload,
                headers={
                    "x-api-key": creds["api_key"],
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                timeout=timeout_seconds or settings.LLM_TIMEOUT_SECONDS,
            )
        if resp.status_code != 200:
            logger.warning("Anthropic returned status %s", resp.status_code)
            return None
        blocks = resp.json().get("content") or []
        text_parts: list[str] = [
            b["text"] for b in blocks if isinstance(b, dict) and isinstance(b.get("text"), str)
        ]
        combined = "".join(text_parts).strip()
        return combined or None

    # ------------------------------------------------------------------ Public
    def generate(
        self,
        messages: list[dict[str, str]],
        timeout_seconds: float | None = None,
        temperature: float = 0.3,
    ) -> str | None:
        """
        Generate a completion. Tries the configured cloud provider first, then
        Ollama. Returns None when every provider fails; never raises.
        """
        if not messages:
            return None

        active_provider = provider_settings.get_active_provider_name()
        if active_provider:
            creds = provider_settings.get_provider_credentials(active_provider)
            if creds:
                result = self._generate_cloud(creds, messages, timeout_seconds, temperature)
                if result is not None:
                    return result

        return self._generate_ollama(messages, timeout_seconds, temperature)

    # ------------------------------------------------------------------ Streaming
    @staticmethod
    def _stream_timeout(timeout_seconds: float | None) -> httpx.Timeout:
        """Per-chunk read timeouts so a slow first token does not kill the stream."""
        base = float(timeout_seconds or settings.LLM_TIMEOUT_SECONDS)
        return httpx.Timeout(base, connect=min(base, 10.0))

    def stream_generate(
        self,
        messages: list[dict[str, str]],
        timeout_seconds: float | None = None,
        temperature: float = 0.3,
    ) -> Iterator[tuple[str, str]]:
        """
        Stream a completion as ("thinking" | "content", text) deltas. Tries the
        configured cloud provider first, then Ollama; mirrors generate()'s
        fallback chain. Ends without yielding when no provider responds.
        """
        if not messages:
            return

        produced = False
        active_provider = provider_settings.get_active_provider_name()
        if active_provider:
            creds = provider_settings.get_provider_credentials(active_provider)
            if creds and self._check_rate_limit(provider_settings.get_global_rate_limit()):
                try:
                    if creds["provider"] == "anthropic":
                        iterator = self._stream_anthropic(
                            creds, messages, timeout_seconds, temperature
                        )
                    else:
                        iterator = self._stream_openai_compatible(
                            creds, messages, timeout_seconds, temperature
                        )
                    for kind, text in iterator:
                        produced = True
                        yield kind, text
                except Exception as exc:
                    logger.warning("Cloud provider '%s' stream failed: %s", creds["provider"], exc)

        if produced:
            return

        yield from self._stream_ollama(messages, timeout_seconds, temperature)

    def _stream_ollama(
        self,
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> Iterator[tuple[str, str]]:
        """NDJSON token stream from Ollama /api/chat with <think> tag routing."""
        if not self._probe_availability():
            return
        payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature},
        }
        try:
            with self._http_semaphore:
                client = get_sync_http_client()
                with client.stream(
                    "POST",
                    f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                    json=payload,
                    timeout=self._stream_timeout(timeout_seconds),
                ) as resp:
                    if resp.status_code != 200:
                        logger.warning("Ollama returned status %s during stream", resp.status_code)
                        self._available = False
                        self._checked_at = time.monotonic()
                        return
                splitter = _ThinkTagSplitter()
                for line in resp.iter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        continue
                    message = obj.get("message") or {}
                    thinking = message.get("thinking")
                    if isinstance(thinking, str) and thinking:
                        yield "thinking", thinking
                    content = message.get("content")
                    if isinstance(content, str) and content:
                        for kind, text in splitter.feed(content):
                            yield kind, text
                for kind, text in splitter.flush():
                    yield kind, text
        except Exception as exc:
            logger.warning("Ollama streaming failed: %s", exc)
            self._available = False
            self._checked_at = time.monotonic()

    def _iter_sse_data(self, resp: httpx.Response) -> Iterator[str]:
        """Yield payloads of SSE `data:` lines from a live httpx response."""
        for line in resp.iter_lines():
            line = line.strip()
            if line.startswith("data:"):
                data = line[5:].strip()
                if data:
                    yield data

    def _stream_openai_compatible(
        self,
        creds: dict[str, Any],
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> Iterator[tuple[str, str]]:
        """SSE token stream from an OpenAI-compatible endpoint (incl. reasoning_content)."""
        base_url = (creds.get("base_url") or "").rstrip("/")
        if not base_url:
            logger.warning("OpenAI-compatible provider has no base URL configured")
            return
        payload = {
            "model": creds.get("model"),
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        with self._http_semaphore:
            client = get_sync_http_client()
            with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {creds['api_key']}",
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                timeout=self._stream_timeout(timeout_seconds),
            ) as resp:
                if resp.status_code != 200:
                    logger.warning(
                        "OpenAI-compatible provider returned status %s during stream", resp.status_code
                    )
                    return
            for data in self._iter_sse_data(resp):
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                except ValueError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                reasoning = delta.get("reasoning_content")
                if isinstance(reasoning, str) and reasoning:
                    yield "thinking", reasoning
                content = delta.get("content")
                if isinstance(content, str) and content:
                    yield "content", content

    def _stream_anthropic(
        self,
        creds: dict[str, Any],
        messages: list[dict[str, str]],
        timeout_seconds: float | None,
        temperature: float,
    ) -> Iterator[tuple[str, str]]:
        """SSE token stream from Anthropic /v1/messages incl. thinking blocks."""
        base_url = (creds.get("base_url") or "https://api.anthropic.com").rstrip("/")
        system_text = "\n".join(m["content"] for m in messages if m.get("role") == "system")
        chat_messages = [m for m in messages if m.get("role") != "system"]
        payload: dict[str, Any] = {
            "model": creds.get("model"),
            "max_tokens": settings.LLM_MAX_TOKENS,
            "temperature": temperature,
            "messages": chat_messages,
            "stream": True,
        }
        if system_text:
            payload["system"] = system_text
        with self._http_semaphore:
            client = get_sync_http_client()
            with client.stream(
                "POST",
                f"{base_url}/v1/messages",
                json=payload,
                headers={
                    "x-api-key": creds["api_key"],
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                timeout=self._stream_timeout(timeout_seconds),
            ) as resp:
                if resp.status_code != 200:
                    logger.warning("Anthropic returned status %s during stream", resp.status_code)
                    return
            for data in self._iter_sse_data(resp):
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                if event.get("type") != "content_block_delta":
                    continue
                delta = event.get("delta") or {}
                delta_type = delta.get("type")
                if delta_type == "thinking_delta" and isinstance(delta.get("thinking"), str):
                    text = delta["thinking"]
                    if text:
                        yield "thinking", text
                elif delta_type == "text_delta" and isinstance(delta.get("text"), str):
                    text = delta["text"]
                    if text:
                        yield "content", text


_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"


class _ThinkTagSplitter:
    """
    Stateful router for models that inline their reasoning as <think>…</think>
    inside the content stream (e.g. DeepSeek-R1 on older Ollama builds). Text
    outside the tags is routed to "content", spans between them to "thinking".
    Handles tags split across chunk boundaries by holding back partial suffixes.
    """

    def __init__(self) -> None:
        self._buf = ""
        self._in_think = False

    @staticmethod
    def _partial_tag_len(text: str, tag: str) -> int:
        max_len = min(len(tag) - 1, len(text))
        for k in range(max_len, 0, -1):
            if text.endswith(tag[:k]):
                return k
        return 0

    def feed(self, chunk: str) -> list[tuple[str, str]]:
        self._buf += chunk
        parts: list[tuple[str, str]] = []
        while True:
            tag = _THINK_CLOSE if self._in_think else _THINK_OPEN
            channel = "thinking" if self._in_think else "content"
            idx = self._buf.find(tag)
            if idx != -1:
                if idx > 0:
                    parts.append((channel, self._buf[:idx]))
                self._buf = self._buf[idx + len(tag) :]
                self._in_think = not self._in_think
                continue
            keep = self._partial_tag_len(self._buf, tag)
            emit_len = len(self._buf) - keep
            if emit_len > 0:
                parts.append((channel, self._buf[:emit_len]))
                self._buf = self._buf[emit_len:]
            break
        return parts

    def flush(self) -> list[tuple[str, str]]:
        parts: list[tuple[str, str]] = []
        if self._buf:
            channel = "thinking" if self._in_think else "content"
            parts.append((channel, self._buf))
            self._buf = ""
        return parts


llm_service = LLMService()
