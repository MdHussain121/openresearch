"""Comprehensive tests for Zotero, Tabby, and Provider Settings services."""

import json
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app.models.project import Project
from app.schemas.models import ZoteroImportRequest, ZoteroSyncRequest
from app.services.auth import create_user_with_personal_owner
from app.services.provider_settings import (
    PROVIDER_DEFINITIONS,
    validate_provider_base_url,
    validate_rate_limit_rpm,
)
from app.services.tabby_setup_service import (
    build_serve_command,
    get_status,
    install_command,
)
from app.services.zotero_service import ZoteroAPIError, ZoteroService


class TestZoteroServiceExtended:
    def test_zotero_import_csl_json(self, db: Session):
        user = create_user_with_personal_owner(
            db=db,
            email="zotero_tester@example.com",
            password="Password123",
            name="Zotero Tester",
        )
        proj = Project(
            name="Zotero Proj",
            owner_id=user.personal_owner_id,
        )
        db.add(proj)
        db.commit()
        db.refresh(proj)

        service = ZoteroService()
        csl_payload = json.dumps([
            {
                "title": "Zotero Research Paper",
                "author": [
                    {"family": "Wonderland", "given": "Alice"},
                    {"literal": "Organization Team"},
                ],
                "issued": {"date-parts": [[2023, 5, 12]]},
                "DOI": "10.1000/zotero123",
                "abstract": "A study of Zotero integration.",
            }
        ])

        req = ZoteroImportRequest(csl_json_content=csl_payload)
        resp = service.import_csl_or_api_data(db=db, project_id=proj.id, request=req)
        assert resp.total_imported == 1
        assert len(resp.papers) == 1
        assert resp.papers[0].title == "Zotero Research Paper"
        assert resp.papers[0].doi == "10.1000/zotero123"

    @patch("app.services.zotero_service.get_sync_http_client")
    def test_zotero_fetch_api_and_sync(self, mock_get_client, db: Session):
        user = create_user_with_personal_owner(
            db=db,
            email="zotero_sync@example.com",
            password="Password123",
            name="Zotero Sync",
        )
        proj = Project(
            name="Zotero Sync Proj",
            owner_id=user.personal_owner_id,
        )
        db.add(proj)
        db.commit()
        db.refresh(proj)

        mock_http = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"Last-Modified-Version": "42"}
        mock_resp.json.return_value = [
            {
                "key": "ITEM1",
                "data": {
                    "title": "Synced Paper",
                    "creators": [{"creatorType": "author", "firstName": "Bob", "lastName": "Builder"}],
                    "date": "2022",
                    "DOI": "10.1000/sync1",
                },
            }
        ]
        mock_http.get.return_value = mock_resp
        mock_get_client.return_value = mock_http

        service = ZoteroService()
        items, version = service._fetch_from_zotero_api("user123", "api_key_123")
        assert len(items) == 1
        assert version == 42

        # Sync library
        sync_req = ZoteroSyncRequest(user_id="user123", api_key="api_key_123")
        sync_res = service.sync_library(db=db, project_id=proj.id, request=sync_req)
        assert sync_res.synced_items_count == 1
        assert sync_res.last_synced_version == 42

    @patch("app.services.zotero_service.get_sync_http_client")
    def test_zotero_fetch_error(self, mock_get_client):
        mock_http = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = "Forbidden"
        mock_http.get.return_value = mock_resp
        mock_get_client.return_value = mock_http

        service = ZoteroService()
        with pytest.raises(ZoteroAPIError):
            service._fetch_from_zotero_api("user123", "invalid_key")


class TestTabbySetupService:
    def test_tabby_get_status(self):
        status = get_status(reachable=True)
        assert isinstance(status, dict)
        assert "installed" in status
        assert "reachable" in status
        assert status["reachable"] is True

    def test_install_command_platforms(self):
        cmd_win = install_command("Windows")
        assert cmd_win is not None
        assert "winget" in cmd_win

        cmd_mac = install_command("Darwin")
        assert cmd_mac is not None
        assert "brew" in cmd_mac

        cmd_unknown = install_command("UnknownOS")
        assert cmd_unknown is None

    def test_build_serve_command(self):
        cmd = build_serve_command("tabby", "http://localhost:8080", "Qwen2.5-Coder-1.5B")
        assert cmd[0] == "tabby"
        assert "serve" in cmd
        assert "--model" in cmd
        assert "Qwen2.5-Coder-1.5B" in cmd
        assert "--port" in cmd
        assert "8080" in cmd


class TestProviderSettingsService:
    def test_validate_provider_base_url(self):
        # Valid URLs
        validate_provider_base_url("https://api.openai.com/v1")
        validate_provider_base_url("https://api.anthropic.com")
        validate_provider_base_url("https://my-custom-llm.example.com/v1")

        # Invalid schemes
        with pytest.raises(ValueError, match="must use http or https"):
            validate_provider_base_url("ftp://api.openai.com")

        # Blocked private / internal / metadata endpoints
        with pytest.raises(ValueError, match=r"metadata|internal"):
            validate_provider_base_url("http://169.254.169.254/latest/meta-data")

        with pytest.raises(ValueError, match=r"private|reserved"):
            validate_provider_base_url("http://192.168.1.1:8000")

        with pytest.raises(ValueError, match=r"private|reserved"):
            validate_provider_base_url("http://10.0.0.1:8000")

    def test_validate_rate_limit_rpm(self):
        assert validate_rate_limit_rpm(None) is None
        assert validate_rate_limit_rpm(60) == 60
        assert validate_rate_limit_rpm("120") == 120

        with pytest.raises(ValueError, match="negative"):
            validate_rate_limit_rpm(-5)

        with pytest.raises(ValueError, match="exceed"):
            validate_rate_limit_rpm(999999)

        with pytest.raises(ValueError, match="whole number"):
            validate_rate_limit_rpm("invalid")

    def test_provider_definitions(self):
        assert len(PROVIDER_DEFINITIONS) >= 3
        providers = [p["provider"] for p in PROVIDER_DEFINITIONS]
        assert "openai" in providers
        assert "anthropic" in providers
        assert "custom" in providers
