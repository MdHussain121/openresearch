import logging
import re
import uuid
from typing import Any

logger = logging.getLogger("openresearch.pdf.reference_extractor")


class ReferenceExtractor:
    def extract(self, full_text: str) -> list[dict[str, Any]]:
        """Extract structured reference entries from bibliography section."""
        references: list[dict[str, Any]] = []
        ref_match = re.search(
            r"\b(?:References|Bibliography|Works Cited)\b[:\s\-\.]*(.*)$",
            full_text,
            re.DOTALL | re.IGNORECASE,
        )
        if not ref_match:
            return references

        ref_block = ref_match.group(1).strip()
        # Split by bracketed numbers e.g. [1], [2] or author/year line breaks
        entries = re.split(r"\n(?=\[\d+\]|\b[A-Z][a-zA-Z\s\.,\-]+,\s*(?:19|20)\d\d)", ref_block)

        for idx, entry in enumerate(entries[:50]):  # Cap at 50 references for speed
            cleaned = re.sub(r"\s+", " ", entry).strip()
            if len(cleaned) < 15:
                continue

            year_match = re.search(r"\b(19\d\d|20[0-2]\d)\b", cleaned)
            year = int(year_match.group(1)) if year_match else None

            # Title heuristics: text between quotes or after authors
            ref_title = cleaned
            quote_match = re.search(r'["“]([^"”]+)["”]', cleaned)
            if quote_match:
                ref_title = quote_match.group(1).strip()
            else:
                parts = cleaned.split(".")
                if len(parts) >= 2:
                    ref_title = parts[1].strip()

            references.append(
                {
                    "id": str(uuid.uuid4()),
                    "index": idx + 1,
                    "title": ref_title[:200],
                    "year": year,
                    "raw_text": cleaned,
                }
            )

        return references
