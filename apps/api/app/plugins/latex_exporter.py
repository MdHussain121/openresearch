"""LaTeX & Overleaf Export Transformer - wraps exported content in a compilable TeX skeleton."""


def on_export(payload: dict, config: dict | None) -> dict:
    cfg = config or {}
    result = dict(payload)

    title = str(result.get("title") or "Untitled Document").replace("\\", "\\textbackslash{}")
    body = str(result.get("content") or "")
    documentclass = str(cfg.get("documentclass", "article"))
    backend = str(cfg.get("bibtex_backend", "biber"))

    preamble_lines = [
        f"\\documentclass{{{documentclass}}}",
        "\\usepackage[utf8]{inputenc}",
        "\\usepackage{hyperref}",
    ]
    if result.get("citations"):
        preamble_lines.append(f"\\usepackage[backend={backend}]{{biblatex}}")

    tex_parts = [
        "\n".join(preamble_lines),
        f"\\title{{{title}}}",
        "\\begin{document}",
        "\\maketitle",
        body,
        "\\end{document}",
    ]

    result["content"] = "\n\n".join(tex_parts)
    result["transform"] = {
        "plugin": "openresearch-latex-exporter",
        "format": "latex",
        "bibtex_backend": backend,
        "bibliography_file": f"{_slug(title)}.bib" if result.get("citations") else None,
    }
    return result


def _slug(title: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")[:80] or "references"
