import pytest

from app.models.plugin import PluginConfig
from app.models.user import User
from app.services.plugin_runtime import PluginEntrypointError
from app.services.plugin_service import PluginService


def _register_and_promote(client, db, email="turing@bletchley.ac.uk"):
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "EnigmaByPassword123", "name": "Alan Turing"},
    )
    token = resp.json()["access_token"]
    user_id = resp.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    db_user = db.query(User).filter(User.id == user_id).first()
    db_user.is_admin = True
    db.commit()
    return headers


def test_plugin_system_lifecycle_and_hooks(client, db):
    # 1. Setup Non-Admin User
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "turing@bletchley.ac.uk",
            "password": "EnigmaByPassword123",
            "name": "Alan Turing",
        },
    )
    token = resp.json()["access_token"]
    user_id = resp.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. List Default Seeded Plugins (Roadmap 9.4 - accessible to regular users)
    list_resp = client.get("/api/v1/plugins", headers=headers)
    assert list_resp.status_code == 200
    plugins = list_resp.json()
    assert len(plugins) >= 5

    by_id = {p["plugin_id"]: p for p in plugins}
    assert "openresearch-arxiv-provider" in by_id
    assert "openresearch-crossref-provider" in by_id
    assert "openresearch-latex-exporter" in by_id
    assert "openresearch-csl-processor" in by_id
    assert "openresearch-ghost-writer" in by_id

    # Built-in plugins ship executable entrypoints
    assert by_id["openresearch-latex-exporter"]["entrypoints"]["on_export"] == (
        "app.plugins.latex_exporter:on_export"
    )

    plugin_payload = {
        "id": "openresearch-semantic-scholar",
        "name": "Semantic Scholar Graph Provider",
        "version": "1.0.0",
        "plugin_type": "research_provider",
        "description": "Enriches research papers with citation influence metrics from Semantic Scholar API.",
        "author": "AI2 Contributor",
        "license": "MIT",
        "entrypoints": {"on_paper_extract": "app.plugins.crossref_provider:on_paper_extract"},
        "settings_schema": {"api_key": "", "batch_size": 50},
    }

    # 3. Non-Admin Attempts to Register Plugin (Should be 403 Forbidden - Roadmap 6.4)
    forbidden_resp = client.post("/api/v1/plugins/register", json=plugin_payload, headers=headers)
    assert forbidden_resp.status_code == 403
    assert "Admin privileges required" in forbidden_resp.json()["error"]["message"]

    # 4. Promote User to Admin
    db_user = db.query(User).filter(User.id == user_id).first()
    db_user.is_admin = True
    db.commit()

    # 5. Admin Registers New AGPL-Compliant Plugin Manifest
    reg_resp = client.post("/api/v1/plugins/register", json=plugin_payload, headers=headers)
    assert reg_resp.status_code == 201
    new_plugin = reg_resp.json()
    assert new_plugin["plugin_id"] == "openresearch-semantic-scholar"
    assert new_plugin["enabled"] is True

    # 6. Admin Toggles Plugin Enabled / Disabled State
    toggle_resp = client.patch(
        f"/api/v1/plugins/{new_plugin['plugin_id']}/toggle",
        json={"enabled": False},
        headers=headers,
    )
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["enabled"] is False

    # 7. Admin Updates Plugin Configuration Settings
    config_resp = client.patch(
        f"/api/v1/plugins/{new_plugin['plugin_id']}/config",
        json={"config_json": {"api_key": "test_s2_key_xyz", "batch_size": 100}},
        headers=headers,
    )
    assert config_resp.status_code == 200
    assert config_resp.json()["config_json"]["batch_size"] == 100

    # 8. Lifecycle Hook Dispatching executes real entrypoint code
    hook_result = PluginService.execute_hook(
        db, "on_paper_extract", {"title": "On Computable Numbers"}
    )
    assert "enriched_by" in hook_result
    assert "openresearch-arxiv-provider" in hook_result["enriched_by"]
    assert "openresearch-crossref-provider" in hook_result["enriched_by"]
    assert hook_result["source"] == "arxiv"


def test_execute_hook_endpoint_transforms_payloads(client, db):
    headers = _register_and_promote(client, db)

    export_resp = client.post(
        "/api/v1/plugins/hooks/on_export",
        json={"payload": {"title": "Computing Machinery", "content": "Hello World"}},
        headers=headers,
    )
    assert export_resp.status_code == 200
    body = export_resp.json()
    assert body["hook_name"] == "on_export"
    assert body["plugin_type"] == "export_transformer"
    assert "\\documentclass{article}" in body["payload"]["content"]
    assert body["payload"]["transform"]["format"] == "latex"
    assert body["payload"]["supports_custom_transform"] is True
    statuses = [e["status"] for e in body["executions"]]
    assert statuses.count("ok") == 1

    cite_resp = client.post(
        "/api/v1/plugins/hooks/on_citation_format",
        json={
            "payload": {
                "authors": ["Alan Turing"],
                "title": "Computing Machinery and Intelligence",
                "year": 1950,
                "venue": "Mind",
                "volume": "LIX",
                "pages": "433-460",
                "doi": "10.1093/mind/LIX236",
            }
        },
        headers=headers,
    )
    assert cite_resp.status_code == 200
    cited = cite_resp.json()["payload"]
    assert cited["style_applied"] == "apa"
    assert cited["formatted"].startswith("Turing, A. (1950).")
    assert "https://doi.org/10.1093/mind/LIX236" in cited["formatted"]

    ai_resp = client.post(
        "/api/v1/plugins/hooks/on_ai_transform",
        json={"payload": {"text": "The machine can think."}},
        headers=headers,
    )
    assert ai_resp.status_code == 200
    ai_body = ai_resp.json()["payload"]
    assert len(ai_body["suggestions"]) > 0
    assert ai_body["grounding_aware"] is True


def test_unknown_hook_returns_400(client, db):
    headers = _register_and_promote(client, db)
    resp = client.post(
        "/api/v1/plugins/hooks/nonexistent_hook", json={"payload": {}}, headers=headers
    )
    assert resp.status_code == 400
    assert "Unknown hook" in resp.json()["error"]["message"]


def test_register_rejects_disallowed_or_malformed_entrypoints(client, db):
    headers = _register_and_promote(client, db, email="admin@bletchley.ac.uk")

    bad_namespace = client.post(
        "/api/v1/plugins/register",
        json={
            "id": "evil-plugin",
            "name": "Evil Plugin",
            "plugin_type": "export_transformer",
            "license": "MIT",
            "entrypoints": {"on_export": "os:system"},
        },
        headers=headers,
    )
    assert bad_namespace.status_code == 400
    assert "allowed plugin namespaces" in bad_namespace.json()["error"]["message"]

    unknown_hook = client.post(
        "/api/v1/plugins/register",
        json={
            "id": "legacy-plugin",
            "name": "Legacy Plugin",
            "plugin_type": "export_transformer",
            "license": "MIT",
            "entrypoints": {"main": "index.js"},
        },
        headers=headers,
    )
    assert unknown_hook.status_code == 400
    assert "Unknown hook 'main'" in unknown_hook.json()["error"]["message"]


def test_failing_plugin_is_isolated_from_dispatch(client, db):
    headers = _register_and_promote(client, db, email="admin2@bletchley.ac.uk")

    broken = client.post(
        "/api/v1/plugins/register",
        json={
            "id": "broken-exporter",
            "name": "Broken Exporter",
            "plugin_type": "export_transformer",
            "license": "MIT",
            "entrypoints": {"on_export": "app.plugins.does_not_exist:on_export"},
        },
        headers=headers,
    )
    assert broken.status_code == 201

    resp = client.post(
        "/api/v1/plugins/hooks/on_export",
        json={"payload": {"title": "T", "content": "body"}},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()

    by_plugin = {e["plugin_id"]: e["status"] for e in body["executions"]}
    assert by_plugin["broken-exporter"] == "error"
    assert by_plugin["openresearch-latex-exporter"] == "ok"

    # Healthy plugin output still applied despite the broken one failing
    assert "\\documentclass{article}" in body["payload"]["content"]


def test_disabled_plugins_are_skipped(client, db):
    headers = _register_and_promote(client, db, email="admin3@bletchley.ac.uk")

    disable = client.patch(
        "/api/v1/plugins/openresearch-latex-exporter/toggle",
        json={"enabled": False},
        headers=headers,
    )
    assert disable.status_code == 200

    resp = client.post(
        "/api/v1/plugins/hooks/on_export",
        json={"payload": {"title": "T", "content": "body"}},
        headers=headers,
    )
    body = resp.json()
    by_plugin = {e["plugin_id"]: e["status"] for e in body["executions"]}
    assert "openresearch-latex-exporter" not in by_plugin
    assert "\\documentclass" not in body["payload"]["content"]


def test_default_plugins_backfill_entrypoints(db):
    legacy = PluginConfig(
        plugin_id="openresearch-ghost-writer",
        name="Academic GhostText Writing Assistant",
        version="1.3.0",
        plugin_type="ai_provider",
        license="MIT",
        enabled=True,
        config_json={},
        entrypoints=None,
    )
    db.add(legacy)
    db.commit()

    PluginService.ensure_default_plugins(db)
    db.refresh(legacy)
    assert legacy.entrypoints == {"on_ai_transform": "app.plugins.ghost_writer:on_ai_transform"}


def test_entrypoint_validation_rules():
    from app.services.plugin_runtime import validate_entrypoint_spec

    validate_entrypoint_spec("app.plugins.arxiv_provider:on_paper_extract")
    with pytest.raises(PluginEntrypointError):
        validate_entrypoint_spec("no-colon-here")
    with pytest.raises(PluginEntrypointError):
        validate_entrypoint_spec("app.plugins..:on_paper_extract")
    with pytest.raises(PluginEntrypointError):
        validate_entrypoint_spec("os:system")
