"""Accessibility contracts verified against the real design-token and i18n sources."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).parents[3]
TOKENS_CSS = REPO_ROOT / "packages" / "tokens" / "src" / "tokens.css"
STRINGS_JSON = REPO_ROOT / "apps" / "web" / "src" / "i18n" / "strings.json"


def _parse_theme_tokens() -> dict[str, dict[str, str]]:
    """Extract color variables per theme block from packages/tokens/src/tokens.css."""
    css = re.sub(r"/\*[\s\S]*?\*/", "", TOKENS_CSS.read_text(encoding="utf-8"))
    themes: dict[str, dict[str, str]] = {}
    for block_match in re.finditer(r"([^{}]+)\{([^}]*)\}", css):
        selector = block_match.group(1).strip()
        body = block_match.group(2)
        if selector == ":root":
            theme = "light"
        elif "data-theme" in selector and "dark" in selector:
            theme = "dark"
        else:
            continue
        colors = themes.setdefault(theme, {})
        for var_match in re.finditer(r"(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})", body):
            colors[var_match.group(1)] = var_match.group(2)
    return themes


def _contrast_ratio(hex1: str, hex2: str) -> float:
    def luminance(hex_str: str) -> float:
        hex_clean = hex_str.lstrip("#")
        r, g, b = [int(hex_clean[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]

        def adjust(c: float) -> float:
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

        return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b)

    l1, l2 = luminance(hex1), luminance(hex2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def test_wcag_contrast_ratios():
    """Verify WCAG 2.1 AA text contrast over the REAL theme tokens (UI/UX §8)."""
    assert TOKENS_CSS.exists(), f"tokens.css not found at {TOKENS_CSS}"
    themes = _parse_theme_tokens()
    assert set(themes) >= {"light", "dark"}, f"both themes must be defined, got {sorted(themes)}"

    for theme in ("light", "dark"):
        colors = themes[theme]
        surface = colors["--bg-surface"]
        for role in ("--text-primary", "--text-secondary"):
            ratio = _contrast_ratio(colors[role], surface)
            assert ratio >= 4.5, (
                f"{theme} {role} on --bg-surface has contrast {ratio:.2f}:1 (needs >= 4.5:1)"
            )


def test_trust_states_have_non_color_cues():
    """Every trust state needs a text label (strings.json) and a defined color in BOTH themes (UI/UX §5.2)."""
    import json

    assert STRINGS_JSON.exists(), f"strings.json not found at {STRINGS_JSON}"
    strings_data = json.loads(STRINGS_JSON.read_text(encoding="utf-8"))
    trust_labels = strings_data.get("trust", {})
    themes = _parse_theme_tokens()

    trust_color_vars = {
        "sourceGrounded": "--source-grounded",
        "aiInference": "--ai-inference",
        "generalKnowledge": "--general-knowledge",
    }
    for key, css_var in trust_color_vars.items():
        label = trust_labels.get(key)
        assert isinstance(label, str) and label.strip(), (
            f"missing accessible text label for trust state '{key}'"
        )
        for theme in ("light", "dark"):
            assert css_var in themes.get(theme, {}), (
                f"trust state '{key}' has no {theme}-theme color token ({css_var}); "
                "state would be conveyed by color alone"
            )


def test_keyboard_shortcuts_contract():
    """Verify all canonical keyboard shortcuts are documented in the app's string table (UI/UX §9)."""
    assert STRINGS_JSON.exists(), f"strings.json not found at {STRINGS_JSON}"
    import json

    strings_data = json.loads(STRINGS_JSON.read_text(encoding="utf-8"))

    shortcuts_section = strings_data.get("shortcuts", {})
    assert "title" in shortcuts_section
    assert "save" in shortcuts_section
    assert "undo" in shortcuts_section
    assert "redo" in shortcuts_section
    assert "find" in shortcuts_section
    assert "openExport" in shortcuts_section
    assert "globalSearch" in shortcuts_section
    assert "openChat" in shortcuts_section
    assert "toggleSourcePanel" in shortcuts_section
    assert "cite" in shortcuts_section
    assert "acceptGhost" in shortcuts_section
    assert "dismissGhost" in shortcuts_section
    assert "shortcutsHelp" in shortcuts_section


def test_vpat_conformance_document_exists():
    """Verify that the VPAT 2.4 Accessibility Conformance document is properly formatted and present."""
    vpat_path = REPO_ROOT / "docs" / "VPAT_CONFORMANCE_STATEMENT.md"
    assert vpat_path.exists(), "VPAT_CONFORMANCE_STATEMENT.md not found in docs/"

    content = vpat_path.read_text(encoding="utf-8")

    assert "WCAG 2.1" in content
    assert "Level A & Level AA" in content
    assert "Principle 1: Perceivable" in content
    assert "Principle 2: Operable" in content
    assert "Principle 3: Understandable" in content
    assert "Principle 4: Robust" in content
    assert "Assistive Technology Testing Matrix" in content
