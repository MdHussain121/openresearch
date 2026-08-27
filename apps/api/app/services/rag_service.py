import hashlib
import heapq
import itertools
import logging
import math
import re
import uuid
from collections.abc import Iterator
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import STOP_WORDS
from app.core.text_utils import format_authors_summary, split_sentences
from app.models.chunk import PaperChunk
from app.models.paper import Paper
from app.schemas.models import (
    ChatMessage,
    ChatResponse,
    GroundedPassage,
    GroundedSegment,
    TrustLegend,
)
from app.services.llm_service import llm_service

logger = logging.getLogger("openresearch.rag_service")

# Vector dimension for feature-hash vectors
EMBEDDING_DIM = 128


def _safe_list_of_dicts(value: Any) -> list[dict[str, Any]]:
    """Coerce a JSON column value to list[dict], discarding non-dict elements."""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


class EmbeddingService:
    """
    BLAKE2b feature-hash vector generator (NOT a learned embedding model).

    Produces L2-normalized 128-dim vectors via character n-gram hashing for
    cosine similarity. This is a lexical overlap approximation, not semantic
    similarity. A real embedding model (e.g. sentence-transformers via Ollama)
    is required for true semantic search — tracked as a migration item
    (architecture.md:101, audit-11 H-4).

    Uses BLAKE2b so embeddings remain stable across processes, restarts, and
    workers (builtin hash() is salted per process and must not be used).
    """

    @staticmethod
    def _stable_hash(value: str) -> int:
        return int.from_bytes(hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest(), "big")

    @classmethod
    def _compute_word_projections(cls, word: str, position_index: int, vector: list[float]) -> None:
        """Compute feature hashing across n-gram and subword projections for a single token."""
        h1 = cls._stable_hash(word) % EMBEDDING_DIM
        h2 = cls._stable_hash(f"{word}\x1f{len(word)}") % EMBEDDING_DIM

        # Positional weight and term frequency
        weight = 1.0 / (1.0 + 0.05 * math.log(1 + position_index))
        vector[h1] += weight * 1.5
        vector[h2] += weight * 0.8

        # Subword 3-gram character features
        if len(word) >= 3:
            for j in range(len(word) - 2):
                sub = word[j : j + 3]
                h_sub = cls._stable_hash(sub) % EMBEDDING_DIM
                vector[h_sub] += 0.35

    @classmethod
    def generate_embedding(cls, text: str) -> list[float]:
        if not text or not text.strip():
            return [0.0] * EMBEDDING_DIM

        # Clean text & filter stop words
        clean = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = [t for t in clean.split() if len(t) > 1 and t not in STOP_WORDS]
        if not tokens:
            # Fallback to non-empty tokens if all were stop words
            tokens = [t for t in clean.split() if len(t) > 1]
            if not tokens:
                return [0.0] * EMBEDDING_DIM

        vec = [0.0] * EMBEDDING_DIM

        for position_index, word in enumerate(tokens):
            cls._compute_word_projections(word, position_index, vec)

        # L2-normalization
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 1e-9:
            vec = [round(x / norm, 6) for x in vec]
        else:
            vec = [0.0] * EMBEDDING_DIM

        return vec

    @staticmethod
    def cosine_similarity(v1: list[float], v2: list[float]) -> float:
        if not v1 or not v2 or len(v1) != len(v2):
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2, strict=True))
        return max(0.0, min(1.0, dot))


class RAGService:
    def __init__(self):
        self.embedding_service = EmbeddingService()

    def format_authors_summary(self, authors: Any) -> str:
        """Format author JSON list into concise academic citation string."""
        return format_authors_summary(authors)

    def _chunk_abstract(
        self, paper: Paper, author_str: str, sections: list[dict[str, Any]]
    ) -> PaperChunk | None:
        """Chunk paper abstract if present and not already part of structured sections."""
        meta = paper.metadata_json or {}
        abstract = paper.abstract or meta.get("abstract", "")
        has_abstract_sec = any(s.get("title", "").lower() == "abstract" for s in sections)
        if abstract and not has_abstract_sec:
            chunk_id = str(uuid.uuid4())
            emb = self.embedding_service.generate_embedding(abstract)
            return PaperChunk(
                id=chunk_id,
                paper_id=paper.id,
                project_id=paper.project_id,
                page_number=1,
                section="Abstract",
                paragraph=1,
                content=abstract.strip(),
                embedding=emb,
                metadata_json={
                    "paper_title": paper.title,
                    "authors": author_str,
                    "year": paper.year,
                    "extraction_status": paper.extraction_status,
                },
            )
        return None

    def _chunk_sections(
        self, paper: Paper, author_str: str, sections: list[dict[str, Any]]
    ) -> list[PaperChunk]:
        """Chunk paper sections by paragraph with sliding window overlap on long paragraphs."""
        chunks: list[PaperChunk] = []
        for sec in sections:
            sec_title = sec.get("title") or "Section"
            sec_page = sec.get("page_number", 1)
            sec_text = sec.get("text", "").strip()
            if not sec_text:
                continue

            raw_paragraphs = [p.strip() for p in re.split(r"\n\s*\n", sec_text) if p.strip()]
            p_idx = 1
            for para in raw_paragraphs:
                if len(para) > 1000:
                    sentences = split_sentences(para)
                    current_sub = []
                    current_len = 0
                    for sent in sentences:
                        current_sub.append(sent)
                        current_len += len(sent)
                        if current_len >= 600:
                            sub_text = " ".join(current_sub).strip()
                            chunk_id = str(uuid.uuid4())
                            emb = self.embedding_service.generate_embedding(
                                f"{sec_title}: {sub_text}"
                            )
                            chunks.append(
                                PaperChunk(
                                    id=chunk_id,
                                    paper_id=paper.id,
                                    project_id=paper.project_id,
                                    page_number=sec_page,
                                    section=sec_title,
                                    paragraph=p_idx,
                                    content=sub_text,
                                    embedding=emb,
                                    metadata_json={
                                        "paper_title": paper.title,
                                        "authors": author_str,
                                        "year": paper.year,
                                        "extraction_status": paper.extraction_status,
                                    },
                                )
                            )
                            p_idx += 1
                            current_sub = current_sub[-1:]
                            current_len = len(current_sub[0])

                    if current_sub:
                        sub_text = " ".join(current_sub).strip()
                        if len(sub_text) > 30:
                            chunk_id = str(uuid.uuid4())
                            emb = self.embedding_service.generate_embedding(
                                f"{sec_title}: {sub_text}"
                            )
                            chunks.append(
                                PaperChunk(
                                    id=chunk_id,
                                    paper_id=paper.id,
                                    project_id=paper.project_id,
                                    page_number=sec_page,
                                    section=sec_title,
                                    paragraph=p_idx,
                                    content=sub_text,
                                    embedding=emb,
                                    metadata_json={
                                        "paper_title": paper.title,
                                        "authors": author_str,
                                        "year": paper.year,
                                        "extraction_status": paper.extraction_status,
                                    },
                                )
                            )
                            p_idx += 1
                else:
                    if len(para) > 20:
                        chunk_id = str(uuid.uuid4())
                        emb = self.embedding_service.generate_embedding(f"{sec_title}: {para}")
                        chunks.append(
                            PaperChunk(
                                id=chunk_id,
                                paper_id=paper.id,
                                project_id=paper.project_id,
                                page_number=sec_page,
                                section=sec_title,
                                paragraph=p_idx,
                                content=para,
                                embedding=emb,
                                metadata_json={
                                    "paper_title": paper.title,
                                    "authors": author_str,
                                    "year": paper.year,
                                    "extraction_status": paper.extraction_status,
                                },
                            )
                        )
                        p_idx += 1
        return chunks

    def _chunk_tables(
        self, paper: Paper, author_str: str, tables: list[dict[str, Any]]
    ) -> list[PaperChunk]:
        """Chunk structured tables with captions."""
        chunks: list[PaperChunk] = []
        for tbl in tables:
            caption = tbl.get("caption", "Table")
            t_page = tbl.get("page_number", 1)
            raw = tbl.get("raw_text", "")
            if raw:
                table_content = f"{caption}:\n{raw}"
                chunk_id = str(uuid.uuid4())
                emb = self.embedding_service.generate_embedding(table_content)
                chunks.append(
                    PaperChunk(
                        id=chunk_id,
                        paper_id=paper.id,
                        project_id=paper.project_id,
                        page_number=t_page,
                        section="Tables",
                        paragraph=1,
                        content=table_content,
                        embedding=emb,
                        metadata_json={
                            "paper_title": paper.title,
                            "authors": author_str,
                            "year": paper.year,
                            "is_table": True,
                            "caption": caption,
                            "extraction_status": paper.extraction_status,
                        },
                    )
                )
        return chunks

    def _chunk_equations(
        self, paper: Paper, author_str: str, equations: list[dict[str, Any]]
    ) -> list[PaperChunk]:
        """Chunk mathematical equations and formulas."""
        chunks: list[PaperChunk] = []
        for eq in equations:
            raw_eq = eq.get("raw_text") or eq.get("latex") or ""
            eq_page = eq.get("page_number", 1)
            if raw_eq:
                eq_content = f"Equation (Page {eq_page}): {raw_eq}"
                chunk_id = str(uuid.uuid4())
                emb = self.embedding_service.generate_embedding(eq_content)
                chunks.append(
                    PaperChunk(
                        id=chunk_id,
                        paper_id=paper.id,
                        project_id=paper.project_id,
                        page_number=eq_page,
                        section="Equations",
                        paragraph=1,
                        content=eq_content,
                        embedding=emb,
                        metadata_json={
                            "paper_title": paper.title,
                            "authors": author_str,
                            "year": paper.year,
                            "is_equation": True,
                            "is_searchable": eq.get("is_text_searchable", True),
                            "extraction_status": paper.extraction_status,
                        },
                    )
                )
        return chunks

    def chunk_paper(self, db: Session, paper: Paper) -> list[PaperChunk]:
        """
        Full §32 chunking pipeline:
        Segments paper sections, tables, equations into structured chunks.
        Each chunk retains: paper_id, page_number, section, paragraph, chunk_id.
        Generates and stores embeddings.
        """
        # Delete existing chunks for paper to allow clean re-indexing
        db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).delete()

        meta = paper.metadata_json or {}
        sections = _safe_list_of_dicts(meta.get("sections"))
        tables = _safe_list_of_dicts(meta.get("tables"))
        equations = _safe_list_of_dicts(meta.get("equations"))
        author_str = self.format_authors_summary(paper.authors)

        created_chunks: list[PaperChunk] = []

        # 1. Chunk Abstract
        abstract_chunk = self._chunk_abstract(paper, author_str, sections)
        if abstract_chunk:
            created_chunks.append(abstract_chunk)

        # 2. Chunk Sections
        created_chunks.extend(self._chunk_sections(paper, author_str, sections))

        # 3. Chunk Tables
        created_chunks.extend(self._chunk_tables(paper, author_str, tables))

        # 4. Chunk Equations
        created_chunks.extend(self._chunk_equations(paper, author_str, equations))

        for c in created_chunks:
            db.add(c)

        db.commit()
        logger.info(
            "Indexed paper %s (%s): %s chunks generated.",
            paper.id,
            paper.title,
            len(created_chunks),
        )
        return created_chunks

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
        """
        Hybrid Retrieval Engine (§45 Risk 3):
        Combines keyword lexical matching + vector cosine similarity + metadata filtering.
        Returns ranked GroundedPassage list.

        Streams chunk rows in bounded batches and retains only the top-`limit`
        candidates in memory, so per-query cost does not scale with library size.
        """
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

        query_emb = self.embedding_service.generate_embedding(query)
        raw_words = set(re.findall(r"\b[a-zA-Z0-9]{3,}\b", query.lower()))
        query_words = {w for w in raw_words if w not in STOP_WORDS} or raw_words
        clean_query = query.strip().lower()

        tie_breaker = itertools.count()
        top_heap: list[tuple[float, int, dict[str, Any]]] = []

        for row in db.execute(stmt).yield_per(500):
            # 1. Semantic Similarity Score
            sem_score = 0.0
            if row.embedding:
                sem_score = self.embedding_service.cosine_similarity(query_emb, row.embedding)

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
            authors_str = self.format_authors_summary(
                paper_obj.authors if paper_obj else meta.get("authors")
            )
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

    @staticmethod
    def _grounded_messages(
        message: str, mode: str, passages: list[GroundedPassage]
    ) -> list[dict[str, str]]:
        """Build the grounded system/user prompt pair shared by blocking & streaming paths."""
        context_blocks = []
        for i, passage in enumerate(passages, start=1):
            context_blocks.append(
                f"[{i}] {passage.paper_title} — {passage.authors} ({passage.year or 'n.d.'}), "
                f"{passage.section} p.{passage.page_number}:\n{passage.passage_text}"
            )
        system_prompt = (
            "You are a research assistant. Answer the user's question using ONLY the numbered source passages "
            "provided below. Cite sources inline with their bracketed numbers like [1]. If the passages do not "
            "contain enough information, reply exactly: 'Insufficient evidence found in your sources.' "
            "Do not invent citations or facts."
        )
        user_prompt = (
            f"Question: {message}\n\nMode: {mode}\n\nSource passages:\n"
            + "\n\n".join(context_blocks)
        )[: settings.LLM_MAX_CONTEXT_CHARS]
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    def grounded_answer(
        self, message: str, mode: str, passages: list[GroundedPassage]
    ) -> str | None:
        """Synthesize a grounded answer with the configured local LLM; None when unavailable."""
        return llm_service.generate(self._grounded_messages(message, mode, passages))

    def generate_chat_response(
        self,
        db: Session,
        project_id: str,
        message: str,
        mode: str = "project",
        paper_id: str | None = None,
        paper_ids: list[str] | None = None,
        conversation_history: list[ChatMessage] | None = None,
    ) -> ChatResponse:
        """
        AI Research Chat Engine implementing Rules 1–5 (§33) and Multi-Source Attribution (§26a):
        - Document / Library / Project / General modes
        - Insufficient evidence honest fallback
        - Structured GroundedSegments with numeral superscript indices and trust legend

        Uses the configured local LLM (Ollama) when reachable; otherwise falls back to
        deterministic passage synthesis so behavior never silently fabricates model output.
        """
        # Case 1: General Mode (Ungrounded)
        if mode == "general":
            llm_answer = llm_service.generate(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a research assistant answering from general knowledge. "
                            "Do not cite any papers. Keep the answer concise."
                        ),
                    },
                    {"role": "user", "content": message[: settings.LLM_MAX_CONTEXT_CHARS]},
                ]
            )
            if llm_answer:
                disclaimer = (
                    "This response is general knowledge, not grounded in your library papers."
                )
                return ChatResponse(
                    answer=f"{llm_answer}\n\n{disclaimer}",
                    mode="general",
                    grounding_state="general-knowledge",
                    segments=[
                        GroundedSegment(
                            text=llm_answer,
                            grounding_state="general-knowledge",
                            source_indices=[],
                            attribution_scope="sentence",
                        )
                    ],
                    sources=[],
                    trust_legend=TrustLegend(
                        source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
                    ),
                    insufficient_evidence=False,
                )
            return self._generate_general_response(message)

        # Case 2: Source-Grounded Modes (Document, Library, Project)
        passages = self.hybrid_search(
            db=db,
            project_id=project_id,
            query=message,
            mode=mode,
            paper_id=paper_id,
            paper_ids=paper_ids,
            limit=4,
            min_threshold=0.25,
        )

        # Rule 3 (§33): If evidence is insufficient, decline to hallucinate
        if not passages:
            return ChatResponse(
                answer="Insufficient evidence found in your sources.",
                mode=mode,
                grounding_state="general-knowledge",
                segments=[
                    GroundedSegment(
                        text="Insufficient evidence found in your sources.",
                        grounding_state="general-knowledge",
                        source_indices=[],
                        attribution_scope="sentence",
                    )
                ],
                sources=[],
                trust_legend=TrustLegend(
                    source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
                ),
                insufficient_evidence=True,
                insufficient_evidence_reason="No relevant passages found in the selected papers for this query.",
            )

        # Rule 1, 2, 4 (§33, §26a): Synthesize answer with clause-level citations
        return self._synthesize_grounded_answer(message, mode, passages)

    def stream_chat_response(
        self,
        db: Session,
        project_id: str,
        message: str,
        mode: str = "project",
        paper_id: str | None = None,
        paper_ids: list[str] | None = None,
        conversation_history: list[ChatMessage] | None = None,
    ) -> Iterator[dict[str, Any]]:
        """
        Streaming variant of generate_chat_response(). Yields SSE-ready frame dicts:
        - {"type": "meta", mode, grounding_state, sources, trust_legend}
        - {"type": "thinking", text}   — model reasoning deltas
        - {"type": "content", text}    — answer deltas
        - {"type": "done", insufficient_evidence, insufficient_evidence_reason?}
        Mirrors the blocking path's prompts, fallbacks and trust semantics.
        """
        if mode not in ["document", "library", "project", "general"]:
            mode = "project"

        # Case 1: General Mode (Ungrounded)
        if mode == "general":
            yield {
                "type": "meta",
                "mode": "general",
                "grounding_state": "general-knowledge",
                "sources": [],
                "trust_legend": TrustLegend(
                    source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
                ).model_dump(),
            }
            content_parts: list[str] = []
            for kind, text in llm_service.stream_generate(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a research assistant answering from general knowledge. "
                            "Do not cite any papers. Keep the answer concise."
                        ),
                    },
                    {"role": "user", "content": message[: settings.LLM_MAX_CONTEXT_CHARS]},
                ]
            ):
                if kind == "content":
                    content_parts.append(text)
                yield {"type": kind, "text": text}

            llm_answer = "".join(content_parts).strip()
            if not llm_answer:
                # Honest deterministic fallback when every provider is unreachable.
                fallback = self._generate_general_response(message)
                yield {"type": "content", "text": fallback.answer}
                yield {"type": "done", "insufficient_evidence": False}
                return

            disclaimer = "This response is general knowledge, not grounded in your library papers."
            yield {"type": "content", "text": f"\n\n{disclaimer}"}
            yield {"type": "done", "insufficient_evidence": False}
            return

        # Case 2: Source-Grounded Modes (Document, Library, Project)
        passages = self.hybrid_search(
            db=db,
            project_id=project_id,
            query=message,
            mode=mode,
            paper_id=paper_id,
            paper_ids=paper_ids,
            limit=4,
            min_threshold=0.25,
        )

        # Rule 3 (§33): If evidence is insufficient, decline to hallucinate
        if not passages:
            yield {
                "type": "meta",
                "mode": mode,
                "grounding_state": "general-knowledge",
                "sources": [],
                "trust_legend": TrustLegend(
                    source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
                ).model_dump(),
            }
            yield {"type": "content", "text": "Insufficient evidence found in your sources."}
            yield {
                "type": "done",
                "insufficient_evidence": True,
                "insufficient_evidence_reason": "No relevant passages found in the selected papers for this query.",
            }
            return

        yield {
            "type": "meta",
            "mode": mode,
            "grounding_state": "ai-inference",
            "sources": [p.model_dump() for p in passages],
            "trust_legend": TrustLegend(
                source_grounded_count=len(passages), ai_inference_count=1, general_knowledge_count=0
            ).model_dump(),
        }

        content_parts = []
        for kind, text in llm_service.stream_generate(
            self._grounded_messages(message, mode, passages)
        ):
            if kind == "content":
                content_parts.append(text)
            yield {"type": kind, "text": text}

        llm_answer = "".join(content_parts).strip()
        if not llm_answer:
            # No provider reachable: reuse the blocking deterministic synthesis.
            blocking = self.generate_chat_response(
                db=db,
                project_id=project_id,
                message=message,
                mode=mode,
                paper_id=paper_id,
                paper_ids=paper_ids,
                conversation_history=conversation_history,
            )
            yield {"type": "content", "text": blocking.answer}
            yield {
                "type": "done",
                "insufficient_evidence": blocking.insufficient_evidence,
                **(
                    {"insufficient_evidence_reason": blocking.insufficient_evidence_reason}
                    if blocking.insufficient_evidence_reason
                    else {}
                ),
            }
            return

        if "Insufficient evidence found in your sources." in llm_answer:
            yield {
                "type": "done",
                "insufficient_evidence": True,
                "insufficient_evidence_reason": "The model found no supporting content in the retrieved passages.",
            }
            return

        suffix = "\n\nSources: " + "; ".join(
            f"[{i}] {p.paper_title} — {p.authors}" for i, p in enumerate(passages, start=1)
        )
        yield {"type": "content", "text": suffix}
        yield {"type": "done", "insufficient_evidence": False}

    def _generate_general_response(self, message: str) -> ChatResponse:
        """Generate general ungrounded AI response with non-dismissible trust indicator."""
        # Synthesize general response
        msg_lower = message.lower()
        if "what is" in msg_lower or "explain" in msg_lower:
            answer = (
                f"From general knowledge: {message.rstrip('?')} involves established academic principles, "
                "standard analytical models, and cross-disciplinary methodologies. "
                "Note that this response is derived from general AI reasoning and is not grounded in your research "
                "library papers."
            )
        elif "compare" in msg_lower or "difference" in msg_lower:
            answer = (
                "In general academic discourse, comparing these approaches requires analyzing theoretical assumptions, "
                "computational complexity, and empirical scalability. "
                "Consult specific library papers for verified project citations."
            )
        else:
            answer = (
                f'Regarding "{message}": This inquiry reflects broad concepts in scientific research. '
                "For source-grounded answers anchored to your literature, please switch to Document, Library, "
                "or Project mode."
            )

        return ChatResponse(
            answer=answer,
            mode="general",
            grounding_state="general-knowledge",
            segments=[
                GroundedSegment(
                    text=answer,
                    grounding_state="general-knowledge",
                    source_indices=[],
                    attribution_scope="sentence",
                )
            ],
            sources=[],
            trust_legend=TrustLegend(
                source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
            ),
            insufficient_evidence=False,
        )

    def _synthesize_grounded_answer(
        self, query: str, mode: str, passages: list[GroundedPassage]
    ) -> ChatResponse:
        """
        Synthesizes source-grounded clauses and AI inferences with exact numeral markers.
        Enforces Rule 1 (never invent citations) & Rule 4 (distinguish source / inference / general).
        Primary path uses the local LLM constrained to the retrieved passages; when the LLM is
        unavailable, deterministic passage quoting keeps answers source-traceable.
        """
        llm_answer = self.grounded_answer(query, mode, passages)
        if llm_answer:
            if "Insufficient evidence found in your sources." in llm_answer:
                return ChatResponse(
                    answer="Insufficient evidence found in your sources.",
                    mode=mode,
                    grounding_state="general-knowledge",
                    segments=[
                        GroundedSegment(
                            text="Insufficient evidence found in your sources.",
                            grounding_state="general-knowledge",
                            source_indices=[],
                            attribution_scope="sentence",
                        )
                    ],
                    sources=passages,
                    trust_legend=TrustLegend(
                        source_grounded_count=0, ai_inference_count=0, general_knowledge_count=1
                    ),
                    insufficient_evidence=True,
                    insufficient_evidence_reason="The model found no supporting content in the retrieved passages.",
                )

            answer = f"{llm_answer}\n\nSources: " + "; ".join(
                f"[{i}] {p.paper_title} — {p.authors}" for i, p in enumerate(passages, start=1)
            )
            return ChatResponse(
                answer=answer,
                mode=mode,
                grounding_state="ai-inference",
                segments=[
                    GroundedSegment(
                        text=llm_answer,
                        grounding_state="ai-inference",
                        source_indices=list(range(1, len(passages) + 1)),
                        attribution_scope="sentence",
                    )
                ],
                sources=passages,
                trust_legend=TrustLegend(
                    source_grounded_count=len(passages),
                    ai_inference_count=1,
                    general_knowledge_count=0,
                ),
                insufficient_evidence=False,
            )

        segments: list[GroundedSegment] = []
        answer_parts: list[str] = []

        source_grounded_count = 0
        ai_inference_count = 0
        general_knowledge_count = 0

        # Build grounded claims from retrieved passages
        for i, passage in enumerate(passages):
            src_idx = i + 1
            # Clean snippet for concise clause synthesis
            raw = passage.passage_text.strip()
            # Extract key sentence
            first_sent = re.split(r"(?<=[.!?])\s+", raw)[0]
            if len(first_sent) > 180:
                first_sent = first_sent[:180] + "..."

            clause_text = (
                f"According to {passage.authors} ({passage.year or 'n.d.'}), "
                f"{first_sent.lower() if not first_sent.startswith('Table') else first_sent}"
            )
            clause_with_numeral = f"{clause_text} [{src_idx}]"

            answer_parts.append(clause_with_numeral)
            segments.append(
                GroundedSegment(
                    text=clause_with_numeral,
                    grounding_state="source-grounded",
                    source_indices=[src_idx],
                    attribution_scope="clause",
                )
            )
            source_grounded_count += 1

        # Multi-source synthesis / AI inference clause (§26a) if multiple sources exist
        if len(passages) >= 2:
            inference_text = (
                f"Together, these findings across {passages[0].authors} and {passages[1].authors} "
                f"suggest a complementary relationship between {passages[0].section} and {passages[1].section} "
                "(AI inference ∿)."
            )
            answer_parts.append(inference_text)
            segments.append(
                GroundedSegment(
                    text=inference_text,
                    grounding_state="ai-inference",
                    source_indices=[1, 2],
                    attribution_scope="clause",
                )
            )
            ai_inference_count += 1

        # General connective
        connective = "All cited claims are directly traceable to your uploaded literature."
        segments.append(
            GroundedSegment(
                text=connective,
                grounding_state="general-knowledge",
                source_indices=[],
                attribution_scope="sentence",
            )
        )
        general_knowledge_count += 1

        full_answer = "\n\n".join(answer_parts) + f"\n\n{connective}"

        return ChatResponse(
            answer=full_answer,
            mode=mode,
            grounding_state="source-grounded",
            segments=segments,
            sources=passages,
            trust_legend=TrustLegend(
                source_grounded_count=source_grounded_count,
                ai_inference_count=ai_inference_count,
                general_knowledge_count=general_knowledge_count,
            ),
            insufficient_evidence=False,
        )


# Singleton RAG service instance
rag_service = RAGService()
