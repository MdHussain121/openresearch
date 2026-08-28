import json
import logging
import secrets
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("openresearch.config")

DEFAULT_DEV_SECRET_KEY = "openresearch_dev_secret_key_change_in_production_32bytes"

KNOWN_COMPROMISED_DEFAULT_SECRETS = {
    DEFAULT_DEV_SECRET_KEY,
    "openresearch_production_super_secret_key_change_me",
    "generate_a_random_32_character_secret_key_here_for_production",
}

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    PROJECT_NAME: str = "OpenResearch API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"

    # Database
    DATABASE_URL: str = "sqlite:///./openresearch_dev.db"

    # Security — no hardcoded default; generated on startup when not provided in dev/test
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days
    LOGIN_RATE_LIMIT_MAX_REQUESTS: int = 10
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300
    REGISTER_RATE_LIMIT_MAX_REQUESTS: int = 20
    REGISTER_RATE_LIMIT_WINDOW_SECONDS: int = 3600

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                try:
                    parsed = json.loads(v)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"CORS_ORIGINS looks like JSON array but failed to parse: {exc}"
                    ) from exc
                if not isinstance(parsed, list) or not all(isinstance(i, str) for i in parsed):
                    raise ValueError("CORS_ORIGINS JSON array must contain only strings")
                return parsed
            return [i.strip() for i in v.split(",") if i.strip()]
        if isinstance(v, list):
            if not all(isinstance(i, str) for i in v):
                raise ValueError("CORS_ORIGINS list must contain only strings")
            return v
        return ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Storage & Upload
    UPLOAD_DIR: str = "./storage/uploads"
    MAX_UPLOAD_SIZE_MB: int = 50

    # Plugin runtime (comma-separated importable module prefixes plugins may live under)
    PLUGIN_ALLOWED_MODULE_PREFIXES: str = "app.plugins."

    # GROBID Settings (supports both GROBID_URL and GROBID_HOST)
    GROBID_URL: str = "http://localhost:8070"

    # LLM Settings (supports both OLLAMA_BASE_URL and OLLAMA_HOST)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"

    # Tabby local autocomplete server (keyless; used only for inline autocomplete).
    # Serve it with --no-webserver so /v1/* does not require a Tabby user account.
    TABBY_BASE_URL: str = "http://localhost:8080"
    TABBY_MODEL: str = "Qwen2.5-Coder-1.5B"
    # Off by default: the user opts in from Settings > AI Autocomplete.
    TABBY_AUTOCOMPLETE_ENABLED: bool = False
    LLM_TIMEOUT_SECONDS: int = 20
    LLM_MAX_CONTEXT_CHARS: int = 12000
    LLM_MAX_TOKENS: int = 1200

    # External service timeouts (seconds)
    GROBID_TIMEOUT_SECONDS: int = 30
    ZOTERO_TIMEOUT_SECONDS: int = 10
    IDENTIFIER_RESOLVER_TIMEOUT_SECONDS: int = 8
    GRAPH_SERVICE_TIMEOUT_SECONDS: int = 10
    TABBY_PROBE_TIMEOUT_SECONDS: int = 2
    TABBY_COMPLETION_TIMEOUT_SECONDS: int = 3
    PROVIDER_SOCKET_TIMEOUT_SECONDS: float = 1.0
    PROVIDER_SOCKET_CONNECT_TIMEOUT_SECONDS: float = 1.0
    AI_WRITING_GHOST_TIMEOUT_SECONDS: float = 3.0
    AI_WRITING_DEFAULT_TIMEOUT_SECONDS: float = 6.0

    # Deprecated: authentication removed — kept for backwards compat, always ignored.
    OPENRESEARCH_DEV_INSECURE_AUTH: bool = False

    @field_validator("OPENRESEARCH_DEV_INSECURE_AUTH", mode="before")
    @classmethod
    def _coerce_dev_auth(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip() in ("1", "true", "True", "yes")
        return bool(v)

    @model_validator(mode="before")
    @classmethod
    def resolve_legacy_aliases(cls, data: dict) -> dict:
        if isinstance(data, dict):
            if "GROBID_URL" not in data and "GROBID_HOST" in data:
                data["GROBID_URL"] = data.pop("GROBID_HOST")
            if "OLLAMA_BASE_URL" not in data and "OLLAMA_HOST" in data:
                data["OLLAMA_BASE_URL"] = data.pop("OLLAMA_HOST")
        return data

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        # Authentication removed: SECRET_KEY is no longer required. Kept for
        # backwards compat with external LLM/JWT callers but never enforced.
        # Auto-generate if missing so legacy JWT helpers still work if called.
        env_lower = self.ENVIRONMENT.strip().lower()

        # OPENRESEARCH_DEV_INSECURE_AUTH is deprecated and ignored.

        if env_lower == "production":
            if self.DATABASE_URL.strip().lower().startswith("sqlite"):
                raise ValueError(
                    "CRITICAL CONFIGURATION ERROR: SQLite is not supported in production. "
                    "Set DATABASE_URL to a PostgreSQL connection string."
                )
        if not self.SECRET_KEY:
            # Generate an ephemeral key so jwt.encode/decode don't crash if
            # legacy code paths are still invoked.
            self.SECRET_KEY = secrets.token_urlsafe(48)
            logger.info(
                "No SECRET_KEY provided; generated ephemeral key for %s environment (auth disabled).",
                env_lower,
            )

        return self


settings = Settings()
