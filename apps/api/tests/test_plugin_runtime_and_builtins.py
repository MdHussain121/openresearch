"""Unit coverage for the plugin runtime loader and every built-in plugin hook."""

import textwrap

import pytest

from app.plugins import (
    arxiv_provider,
    crossref_provider,
    csl_processor,
    ghost_writer,
    latex_exporter,
)
from app.services import plugin_runtime
from app.services.plugin_runtime import (
    PluginEntrypointError,
    clear_resolution_cache,
    dispatch_hook,
    resolve_entrypoint,
    validate_entrypoint_spec,
)

# ---------------------------------------------------------------------------
# Runtime: entrypoint resolution & allowlist
# ---------------------------------------------------------------------------


def test_validate_entrypoint_accepts_allowed_module():
    validate_entrypoint_spec("app.plugins.arxiv_provider:on_paper_extract")


@pytest.mark.parametrize(
    "spec",
    [
        "no-colon-here",
        "two:colons:here",
        "app.plugins..:on_paper_extract",
        ".relative.module:hook",
        "os:system",
        "subprocess:run",
        "app.plugins.arxiv_provider:",
        ":orphan_function",
    ],
)
def test_validate_entrypoint_rejects_bad_specs(spec):
    with pytest.raises(PluginEntrypointError):
        validate_entrypoint_spec(spec)


def test_resolve_entrypoint_caches_and_validates_callable():
    clear_resolution_cache()
    func = resolve_entrypoint("app.plugins.latex_exporter:on_export")
    assert callable(func)
    assert resolve_entrypoint("app.plugins.latex_exporter:on_export") is func
    clear_resolution_cache()

    with pytest.raises(PluginEntrypointError, match="Cannot resolve"):
        resolve_entrypoint("app.plugins.no_such_module:on_export")
    with pytest.raises(PluginEntrypointError, match="Cannot resolve"):
        resolve_entrypoint("app.plugins.latex_exporter:no_such_hook")
    with pytest.raises(PluginEntrypointError, match="not callable"):
        resolve_entrypoint("app.plugins.arxiv_provider:_ARXIV_NEW_STYLE")
    clear_resolution_cache()


def test_dispatch_rejects_unknown_hook(db):
    with pytest.raises(PluginEntrypointError, match="Unknown hook"):
        dispatch_hook(db, "on_nonexistent", {})


def test_custom_namespace_allowlist(monkeypatch, tmp_path, db):
    plugin_dir = tmp_path / "ext_plugins"
    plugin_dir.mkdir()
    (plugin_dir / "__init__.py").write_text("")
    (plugin_dir / "bad_hook.py").write_text(
        textwrap.dedent(
            """
            def on_export(payload, config):
                return "not-a-dict"
            """
        )
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setattr(
        plugin_runtime.settings, "PLUGIN_ALLOWED_MODULE_PREFIXES", "app.plugins., ext_plugins."
    )

    spec = "ext_plugins.bad_hook:on_export"
    validate_entrypoint_spec(spec)

    from app.models.plugin import PluginConfig

    db.add(
        PluginConfig(
            plugin_id="ext-bad-hook",
            name="Bad Hook",
            version="1.0.0",
            plugin_type="export_transformer",
            license="MIT",
            enabled=True,
            config_json={},
            entrypoints={"on_export": spec},
        )
    )
    db.add(
        PluginConfig(
            plugin_id="healthy-exporter",
            name="Healthy Exporter",
            version="1.0.0",
            plugin_type="export_transformer",
            license="MIT",
            enabled=True,
            config_json={"documentclass": "article"},
            entrypoints={"on_export": "app.plugins.latex_exporter:on_export"},
        )
    )
    db.commit()

    result, executions = dispatch_hook(db, "on_export", {"title": "T", "content": "b"})
    entry = next(e for e in executions if e["plugin_id"] == "ext-bad-hook")
    assert entry["status"] == "error"
    assert "Hook must return a dict payload" in entry["error"]
    assert next(e for e in executions if e["plugin_id"] == "healthy-exporter")["status"] == "ok"
    assert "\\documentclass{article}" in result["content"]
    assert result["supports_custom_transform"] is True


def test_skips_plugins_without_matching_entrypoint(db):
    from app.models.plugin import PluginConfig
    from app.services.plugin_service import PluginService

    PluginService.ensure_default_plugins(db)
    db.add(
        PluginConfig(
            plugin_id="silent-provider",
            name="Silent Provider",
            version="1.0.0",
            plugin_type="research_provider",
            license="MIT",
            enabled=True,
            config_json={},
            entrypoints=None,
        )
    )
    db.commit()

    result, executions = dispatch_hook(db, "on_paper_extract", {"title": "T"})
    entry = next(e for e in executions if e["plugin_id"] == "silent-provider")
    assert entry == {"plugin_id": "silent-provider", "status": "skipped", "reason": "no_entrypoint"}
    assert result["enriched_by"] == [
        "openresearch-crossref-provider",
        "openresearch-arxiv-provider",
    ]


# ---------------------------------------------------------------------------
# Built-in: arXiv provider
# ---------------------------------------------------------------------------


def test_arxiv_extracts_modern_id_from_url_and_categories():
    payload = arxiv_provider.on_paper_extract(
        {
            "title": "Attention Is All You Need cs.CL",
            "url": "https://arxiv.org/abs/1706.03762v7",
        },
        {},
    )
    assert payload["arxiv_id"] == "1706.03762v7"
    assert payload["source_id"] == "arXiv:1706.03762v7"
    assert "cs.cl" in payload["arxiv_categories"]
    assert payload["source"] == "arxiv"


def test_arxiv_falls_back_to_doi_prefix_and_respects_config():
    payload = arxiv_provider.on_paper_extract(
        {"doi": "10.48550/arXiv.2005.14165"}, {"auto_extract_categories": False}
    )
    assert payload["source_id"] == "arXiv:2005.14165"
    assert "arxiv_categories" not in payload

    plain = arxiv_provider.on_paper_extract({"title": "No identifiers here"}, {})
    assert "arxiv_id" not in plain
    assert plain["source"] == "arxiv"


def test_arxiv_pdf_url_and_category_cap():
    payload = arxiv_provider.on_paper_extract(
        {
            "pdf_url": "https://arxiv.org/pdf/1506.02640",
            "abstract": "cs.LG stat.ML math.CO physics",
        },
        {"max_results": 2},
    )
    assert payload["arxiv_id"] == "1506.02640"
    assert len(payload["arxiv_categories"]) <= 2


# ---------------------------------------------------------------------------
# Built-in: CrossRef provider
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        "10.1038/nature12373",
        "https://doi.org/10.1038/Nature12373",
        "http://dx.doi.org/10.1038/nature12373",
        "doi:10.1038/nature12373",
    ],
)
def test_crossref_normalizes_every_doi_form(raw):
    out = crossref_provider.on_paper_extract({"doi": raw}, {})
    assert out["doi"] == "10.1038/nature12373"
    assert out["metadata_source"] == "crossref"
    assert out["doi_url"] == "https://doi.org/10.1038/nature12373"


def test_crossref_http_preference_and_noop_without_doi():
    out = crossref_provider.on_paper_extract({"doi": "doi:10.1/x"}, {"prefer_https": False})
    assert out["doi_url"].startswith("http://")

    untouched = crossref_provider.on_paper_extract({"title": "no doi"}, {})
    assert "doi_url" not in untouched


# ---------------------------------------------------------------------------
# Built-in: LaTeX exporter
# ---------------------------------------------------------------------------


def test_latex_wraps_content_with_bibliography():
    out = latex_exporter.on_export(
        {"title": "Deep Learning", "content": "Chapter one.", "citations": [{"id": "goodfellow"}]},
        {"documentclass": "book", "bibtex_backend": "bibtex"},
    )
    assert "\\documentclass{book}" in out["content"]
    assert "\\usepackage[backend=bibtex]{biblatex}" in out["content"]
    assert out["transform"]["bibliography_file"] == "deep-learning.bib"
    assert out["transform"]["format"] == "latex"


def test_latex_without_citations_has_no_bib_file():
    out = latex_exporter.on_export({"title": "Plain", "content": ""}, None)
    assert "biblatex" not in out["content"]
    assert out["transform"]["bibliography_file"] is None
    assert out["content"].endswith("\\end{document}")


# ---------------------------------------------------------------------------
# Built-in: CSL processor
# ---------------------------------------------------------------------------


CITATION = {
    "authors": ["Alan Turing", "Grace Hopper"],
    "title": "Computing Machinery and Intelligence",
    "year": 1950,
    "venue": "Mind",
    "volume": "LIX",
    "pages": "433-460",
    "doi": "10.1093/mind/LIX236",
}


def test_csl_uses_config_style_and_defaults():
    out = csl_processor.on_citation_format(dict(CITATION), {"style": "ieee"})
    assert out["style_applied"] == "ieee"
    assert "vol. LIX" in out["formatted"]

    fallback = csl_processor.on_citation_format(dict(CITATION), {"style": "klingon"})
    assert fallback["style_applied"] == "apa"


@pytest.mark.parametrize(
    "style,marker",
    [
        ("apa", "(1950)."),
        ("harvard", "'Computing Machinery and Intelligence'"),
        ("vancouver", "Mind; LIX:433-460. 1950."),
        ("mla", "et al."),
        ("chicago", "(1950): 433-460"),
    ],
)
def test_csl_all_styles(style, marker):
    out = csl_processor.on_citation_format(dict(CITATION), {"style": style})
    assert marker in out["formatted"]


def test_csl_handles_sparse_and_string_authors():
    sparse = csl_processor.on_citation_format({}, {"style": "apa"})
    assert "Untitled" in sparse["formatted"]
    assert "n.d." in sparse["formatted"]

    string_authors = csl_processor.on_citation_format(
        {"authors": "Solo Author", "title": "T", "year": 2000}, {"style": "apa"}
    )
    assert string_authors["formatted"].startswith("Author, S.")


# ---------------------------------------------------------------------------
# Built-in: Ghost writer
# ---------------------------------------------------------------------------


def test_ghost_writer_produces_suggestions():
    out = ghost_writer.on_ai_transform({"text": "The results indicate that"}, {"max_tokens": 20})
    assert 0 < len(out["suggestions"]) <= 3
    assert out["debounce_ms"] == 700
    assert out["grounding_aware"] is True


def test_ghost_writer_empty_text_is_safe():
    out = ghost_writer.on_ai_transform({"text": ""}, None)
    assert out["suggestions"] == []
