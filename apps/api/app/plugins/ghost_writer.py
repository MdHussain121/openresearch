"""Academic GhostText Writing Assistant - deterministic inline continuation suggestions."""

_SENTENCE_SPLIT = (". ", "! ", "? ")
_CONNECTORS = ["therefore", "furthermore", "in addition", "however", "consequently"]


def on_ai_transform(payload: dict, config: dict | None) -> dict:
    cfg = config or {}
    result = dict(payload)

    text = str(result.get("text") or "").rstrip()
    max_tokens = int(cfg.get("max_tokens", 40))
    temperature = float(cfg.get("temperature", 0.3))

    suggestions: list[str] = []
    if text:
        fragment = _last_fragment(text)
        words = fragment.split() if fragment else []
        if words:
            lead = words[-1].lower().strip(",;:")
            for i, connector in enumerate(_CONNECTORS):
                seed = (sum(ord(c) for c in lead) + i * 7 + int(temperature * 10)) % len(
                    _CONNECTORS
                )
                suggestion = (
                    f"{connector.title() if fragment.endswith(('.', '!', '?')) else connector} "
                )
                suggestion += _continuation(
                    lead, _CONNECTORS[(seed + i) % len(_CONNECTORS)], max_tokens
                )
                suggestions.append(suggestion)

    result["suggestions"] = suggestions[:3]
    result["debounce_ms"] = int(cfg.get("debounce_ms", 700))
    result["grounding_aware"] = True
    return result


def _last_fragment(text: str) -> str:
    for sep in _SENTENCE_SPLIT:
        text = text.rsplit(sep, 1)[-1]
    return text.strip()


def _continuation(lead: str, connector: str, max_tokens: int) -> str:
    filler = (
        f"{lead}-related findings support this direction"
        if lead.isalpha()
        else "the argument continues here"
    )
    words = f"{connector}, {filler}".split()
    return " ".join(words[: max(max_tokens // 2, 2)])
