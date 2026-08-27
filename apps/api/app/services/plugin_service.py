import logging
from typing import Any, cast

from sqlalchemy.orm import Session

from app.models.plugin import PluginConfig
from app.schemas.models import PluginManifest
from app.services.plugin_runtime import (
    HOOK_REGISTRY,
    PluginEntrypointError,
    dispatch_hook,
    validate_entrypoint_spec,
)

logger = logging.getLogger("openresearch.plugin_service")

DEFAULT_PLUGINS = [
    {
        "plugin_id": "openresearch-arxiv-provider",
        "name": "arXiv Academic Literature Connector",
        "version": "1.2.0",
        "plugin_type": "research_provider",
        "description": "Searches and retrieves metadata, abstracts, and open-access PDFs directly from arXiv API.",
        "author": "OpenResearch Core Team",
        "license": "MIT",
        "enabled": True,
        "config_json": {"timeout_seconds": 15, "max_results": 20, "auto_extract_categories": True},
        "entrypoints": {"on_paper_extract": "app.plugins.arxiv_provider:on_paper_extract"},
    },
    {
        "plugin_id": "openresearch-crossref-provider",
        "name": "CrossRef & DOI Metadata Resolver",
        "version": "1.1.0",
        "plugin_type": "research_provider",
        "description": "Resolves DOIs to full CSL bibliographic metadata via CrossRef REST API.",
        "author": "OpenResearch Core Team",
        "license": "MIT",
        "enabled": True,
        "config_json": {"mailto_header": "researcher@openresearch.local", "prefer_https": True},
        "entrypoints": {"on_paper_extract": "app.plugins.crossref_provider:on_paper_extract"},
    },
    {
        "plugin_id": "openresearch-latex-exporter",
        "name": "LaTeX & Overleaf Export Transformer",
        "version": "1.0.4",
        "plugin_type": "export_transformer",
        "description": "Transforms academic documents into structured TeX documents with standalone .bib files.",
        "author": "OpenResearch Contributors",
        "license": "MIT",
        "enabled": True,
        "config_json": {"documentclass": "article", "bibtex_backend": "biber"},
        "entrypoints": {"on_export": "app.plugins.latex_exporter:on_export"},
    },
    {
        "plugin_id": "openresearch-csl-processor",
        "name": "Citation Style Language (CSL) Engine",
        "version": "2.0.1",
        "plugin_type": "citation_processor",
        "description": "High-fidelity CSL parsing supporting APA 7, MLA 9, Chicago, IEEE, Harvard, and Vancouver.",
        "author": "OpenResearch Core Team",
        "license": "MIT",
        "enabled": True,
        "config_json": {"locale": "en-US", "disambiguation": "by-cite", "style": "apa"},
        "entrypoints": {"on_citation_format": "app.plugins.csl_processor:on_citation_format"},
    },
    {
        "plugin_id": "openresearch-ghost-writer",
        "name": "Academic GhostText Writing Assistant",
        "version": "1.3.0",
        "plugin_type": "ai_provider",
        "description": "Sub-300ms inline ghost text autocomplete with source-grounding awareness.",
        "author": "OpenResearch AI Lab",
        "license": "MIT",
        "enabled": True,
        "config_json": {"debounce_ms": 700, "temperature": 0.3, "max_tokens": 40},
        "entrypoints": {"on_ai_transform": "app.plugins.ghost_writer:on_ai_transform"},
    },
]


class PluginService:
    @staticmethod
    def ensure_default_plugins(db: Session) -> None:
        """Seed default plugin configs if none exist; backfill entrypoints on legacy rows."""
        for p in DEFAULT_PLUGINS:
            existing = (
                db.query(PluginConfig).filter(PluginConfig.plugin_id == p["plugin_id"]).first()
            )
            if not existing:
                plugin_obj = PluginConfig(
                    plugin_id=p["plugin_id"],
                    name=p["name"],
                    version=p["version"],
                    plugin_type=p["plugin_type"],
                    description=p["description"],
                    author=p["author"],
                    license=p["license"],
                    enabled=p["enabled"],
                    config_json=p["config_json"],
                    entrypoints=p.get("entrypoints"),
                )
                db.add(plugin_obj)
            elif not existing.entrypoints and p.get("entrypoints"):
                existing.entrypoints = cast(dict[str, str], p["entrypoints"])
        db.commit()

    @staticmethod
    def list_plugins(db: Session) -> list[PluginConfig]:
        PluginService.ensure_default_plugins(db)
        return db.query(PluginConfig).order_by(PluginConfig.name.asc()).all()

    @staticmethod
    def get_plugin(db: Session, plugin_id: str) -> PluginConfig | None:
        PluginService.ensure_default_plugins(db)
        return (
            db.query(PluginConfig)
            .filter((PluginConfig.plugin_id == plugin_id) | (PluginConfig.id == plugin_id))
            .first()
        )

    @staticmethod
    def register_plugin(db: Session, manifest: PluginManifest) -> PluginConfig:
        for hook_name, spec in (manifest.entrypoints or {}).items():
            if hook_name not in HOOK_REGISTRY:
                raise PluginEntrypointError(
                    f"Unknown hook '{hook_name}'; valid hooks: {sorted(HOOK_REGISTRY)}"
                )
            validate_entrypoint_spec(spec)

        existing = db.query(PluginConfig).filter(PluginConfig.plugin_id == manifest.id).first()
        if existing:
            existing.name = manifest.name
            existing.version = manifest.version
            existing.plugin_type = manifest.plugin_type
            existing.description = manifest.description
            existing.author = manifest.author
            existing.license = manifest.license
            if manifest.entrypoints:
                existing.entrypoints = manifest.entrypoints
            db.commit()
            db.refresh(existing)
            return existing

        plugin_obj = PluginConfig(
            plugin_id=manifest.id,
            name=manifest.name,
            version=manifest.version,
            plugin_type=manifest.plugin_type,
            description=manifest.description,
            author=manifest.author,
            license=manifest.license,
            enabled=True,
            config_json=manifest.settings_schema or {},
            entrypoints=manifest.entrypoints or None,
        )
        db.add(plugin_obj)
        db.commit()
        db.refresh(plugin_obj)
        return plugin_obj

    @staticmethod
    def toggle_plugin(db: Session, plugin_id: str, enabled: bool) -> PluginConfig | None:
        plugin = PluginService.get_plugin(db, plugin_id)
        if not plugin:
            return None
        plugin.enabled = enabled
        db.commit()
        db.refresh(plugin)
        return plugin

    @staticmethod
    def update_plugin_config(
        db: Session, plugin_id: str, config_json: dict[str, Any]
    ) -> PluginConfig | None:
        plugin = PluginService.get_plugin(db, plugin_id)
        if not plugin:
            return None
        plugin.config_json = config_json
        db.commit()
        db.refresh(plugin)
        return plugin

    @staticmethod
    def execute_hook(db: Session, hook_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Executes a registered plugin extension hook by loading and invoking
        each enabled plugin's entrypoint (AGPL-3.0 compliant).
        """
        PluginService.ensure_default_plugins(db)
        result, executions = dispatch_hook(db, hook_name, payload)
        failures = [e for e in executions if e.get("status") == "error"]
        if failures:
            logger.warning(
                "Plugin hook %s had %d failure(s): %s",
                hook_name,
                len(failures),
                [f"{e['plugin_id']}: {e.get('error')}" for e in failures],
            )
        return result

    @staticmethod
    def execute_hook_detailed(
        db: Session, hook_name: str, payload: dict[str, Any]
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Same as execute_hook but also returns the per-plugin execution log."""
        PluginService.ensure_default_plugins(db)
        return dispatch_hook(db, hook_name, payload)
