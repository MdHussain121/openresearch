import heapq
import itertools
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import STOP_WORDS
from app.models.chunk import PaperChunk
from app.models.paper import Paper
from app.schemas.models import GroundedPassage
from app.services.rag.embeddings import EmbeddingGenerator

logger = logging.getLogger("openresearch.rag.retriever")


def _safe_list_of_dicts(value: Any) -> list[dict[str, Any]]:
    """Coerce a JSON column value to list[dict], discarding non-dict elements."""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


class HybridRetriever:
    """
    Hybrid Retrieval Engine (§45 Risk 3):
    Combines keyword lexical matching + vector cosine similarity + metadata filtering.
    Returns ranked GroundedPassage list.

    Streams chunk rows in bounded batches and retains only the top-`limit`
    candidates in memory, so per-query cost does not scale with library size.
    """

    def __init__(self):
        self.embedding_generator = EmbeddingGenerator()

    def hybrid_search(
        self,
        db: Session,
        project_id: str,
        query: str,
        mode: str = "project",
        paper_id: str | None = None,
        paper_ids: list[str] | None = None,
        limit: int = 5,
        min_threshold: float = 0.18,
    ) -> list[GroundedPassage]:
        if not query or not query.strip():
            return []

        stmt = select(
            PaperChunk.id,
            PaperChunk.paper_id,
            PaperChunk.page_number,
            PaperChunk.section,
            PaperChunk.paragraph,
            PaperChunk.content,
            PaperChunk.embedding,
            PaperChunk.metadata_json,
        ).where(PaperChunk.project_id == project_id)

        if mode == "document" and paper_id:
            stmt = stmt.where(PaperChunk.paper_id == paper_id)
        elif mode == "library" and paper_ids:
            stmt = stmt.where(PaperChunk.paper_id.in_(paper_ids))
        elif mode == "general":
            return []

        query_emb = self.embedding_generator.generate_embedding(query)
        raw_words = set(re.findall(r"\b[a-zA-Z0-9]{3,}\b", query.lower()))
        query_words = {w for w in raw_words if w not in STOP_WORDS} or raw_words
        clean_query = query.strip().lower()

        tie_breaker = itertools.count()
        top_heap: list[tuple[float, int, dict[str, Any]]] = []

        for row in db.execute(stmt).yield_per(500):
            # 1. Semantic Similarity Score
            sem_score = 0.0
            if row.embedding:
                sem_score = self.embedding_generator.cosine_similarity(query_emb, row.embedding)

            # 2. Keyword BM25 / Lexical Overlap Score
            content_lower = row.content.lower()
            section_lower = (row.section or "").lower()

            matched_words = 0
            for w in query_words:
                if w in content_lower or w in section_lower:
                    matched_words += 1

            lexical_score = (matched_words / max(len(query_words), 1)) if query_words else 0.0

            # Phrase match bonus
            if len(clean_query) > 5 and clean_query in content_lower:
                lexical_score = min(1.0, lexical_score + 0.35)

            # 3. Hybrid Combined Score (§45 Risk 3, §33 Rule 3)
            # If query has topical words but zero match in content/section/title, require high semantic confidence
            if query_words and matched_words == 0:
                if sem_score < 0.68:
                    hybrid_score = 0.0
                else:
                    hybrid_score = 0.55 * sem_score
            else:
                hybrid_score = (0.55 * sem_score) + (0.45 * lexical_score)

            # Check unverified extraction penalty (§11a, §33 Rule 3)
            meta = row.metadata_json or {}
            is_unverified = meta.get("extraction_status") == "unverified"
            if is_unverified:
                hybrid_score *= 0.85  # Slight penalty for unverified

            if hybrid_score < min_threshold:
                continue

            candidate = {
                "score": hybrid_score,
                "chunk_id": row.id,
                "paper_id": row.paper_id,
                "page_number": row.page_number,
                "section": row.section,
                "paragraph": row.paragraph,
                "passage_text": row.content,
                "meta": meta,
            }
            if len(top_heap) < limit:
                heapq.heappush(top_heap, (hybrid_score, next(tie_breaker), candidate))
            elif hybrid_score > top_heap[0][0]:
                heapq.heapreplace(top_heap, (hybrid_score, next(tie_breaker), candidate))

        if not top_heap:
            return []

        ordered = sorted(top_heap, key=lambda item: item[0], reverse=True)

        # Hydrate paper details for only the surviving candidates (single batched query)
        paper_cache: dict[str, Paper] = {}
        needed_ids = {item[2]["paper_id"] for item in ordered}
        if needed_ids:
            for p in db.query(Paper).filter(Paper.id.in_(needed_ids)).all():
                paper_cache[p.id] = p

        scored_passages: list[GroundedPassage] = []
        for score, _, cand in ordered:
            meta = cand["meta"]
            paper_obj = paper_cache.get(cand["paper_id"])
            paper_title = (
                paper_obj.title if paper_obj else meta.get("paper_title", "Research Paper")
            )
            # Note: format_authors_summary will be passed from RAGService facade
            authors_str = meta.get("authors", "")
            year = paper_obj.year if paper_obj else meta.get("year")

            scored_passages.append(
                GroundedPassage(
                    paper_id=cand["paper_id"],
                    paper_title=paper_title,
                    authors=authors_str,
                    year=year,
                    page_number=cand["page_number"],
                    section=cand["section"],
                    paragraph=cand["paragraph"],
                    passage_text=cand["passage_text"],
                    confidence=round(score, 3),
                    chunk_id=cand["chunk_id"],
                    score=round(score, 3),
                )
            )
        return scored_passages
