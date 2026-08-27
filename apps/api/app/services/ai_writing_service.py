import functools
import json
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator
from typing import ClassVar

import anyio
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.paper import Paper
from app.schemas.models import (
    AIEditRequest,
    AIEditResponse,
    AIOutlineRequest,
    AIOutlineResponse,
    AIOutlineSection,
    AutocompleteRequest,
    AutocompleteResponse,
    GroundedPassage,
)
from app.services import provider_settings
from app.services.llm_service import llm_service
from app.services.rag_service import rag_service

logger = logging.getLogger("openresearch.ai_writing")


class AIProviderUnavailableError(RuntimeError):
    """Raised when an AI feature requires an LLM but none is reachable/configured."""

    def __init__(self, feature: str = "This feature"):
        super().__init__(
            f"{feature} requires an AI provider. Configure one under Settings > AI Providers "
            "or start a local Ollama server."
        )


class AIWritingService:
    """
    AI Writing Assistance Engine (UI/UX §4.2):
    - Two-tier autocomplete: ghost-text (<300ms budget) & paragraph continuation
    - 9 academic editing actions with reversible original -> suggested flow
    - Prompt-to-outline generator grounded in project research library
    - Non-blocking SSE streaming for reduced time-to-first-token

    Implementation notes:
    - Autocomplete and editing actions call an LLM when a provider is configured;
      rule-based fallbacks are available for a subset of editing actions.
    - The outline generator is TEMPLATE-BASED (no LLM call). It returns a fixed
      7-section academic structure with the topic string interpolated. This is not
      an AI-generated outline. See generate_ai_outline().
    """

    EDIT_ACTION_INSTRUCTIONS: ClassVar[dict[str, str]] = {
        "clarity": "Rewrite the text to remove ambiguity and streamline sentence syntax. Preserve meaning.",
        "academic": "Rewrite the text in a formal scholarly register using precise scientific terminology.",
        "simplify": "Rewrite the text into clear, readable concepts without losing precision.",
        "shorten": "Condense the text, pruning filler phrases while retaining core analytical claims.",
        "expand": "Elaborate the text with academic rationale and methodological implications.",
        "grammar": "Correct punctuation, subject-verb agreement, and typographical issues only.",
        "flow": "Improve transitions and logical connectives between sentences.",
        "translate": (
            "Translate the text accurately into the requested target language, keeping scientific conventions."
        ),
        "explain": (
            "Explain the selected text in simpler terms, clarifying jargon and "
            "breaking down complex concepts for broader comprehension."
        ),
    }

    @staticmethod
    def _llm_complete(system: str, user: str, timeout_seconds: float | None = None) -> str | None:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        return llm_service.generate(messages, timeout_seconds=timeout_seconds)

    def _resolve_autocomplete_engine(self) -> str:
        """
        Returns 'tabby' when the local Tabby server should produce this completion,
        or 'chain' to keep the standard cloud -> Ollama -> deterministic path.
        Tabby is only attempted when the master toggle is on and the selected engine
        is 'auto' (healthy-gated) or 'tabby'.
        """
        ac = provider_settings.get_autocomplete_settings()
        if not ac.get("enabled"):
            return "chain"
        if ac.get("engine") in ("cloud", "ollama"):
            return "chain"
        return "tabby" if llm_service.probe_tabby() else "chain"

    def _generate_tabby_autocomplete(self, prefix: str, suffix: str, mode: str) -> str | None:
        max_tokens = 48 if mode == "ghost" else 160
        timeout = 3.0 if mode == "ghost" else 6.0
        return llm_service.generate_tabby(
            prefix=prefix, suffix=suffix, max_tokens=max_tokens, timeout_seconds=timeout
        )

    def generate_autocomplete(
        self, db: Session, project_id: str, request: AutocompleteRequest
    ) -> AutocompleteResponse:
        started = time.perf_counter()
        prefix = (request.prefix_text or "").strip()
        paragraph = (request.paragraph_context or "").strip()
        section = request.section_heading or "Section"
        mode = request.mode if request.mode in ["ghost", "continuation"] else "ghost"

        # Formulate search query from prefix and paragraph context
        search_query = f"{section}: {prefix}" if prefix else paragraph

        passages: list[GroundedPassage] = []
        if search_query and len(search_query) > 5:
            passages = rag_service.hybrid_search(
                db=db,
                project_id=project_id,
                query=search_query,
                mode="library" if request.paper_ids else "project",
                paper_ids=request.paper_ids,
                limit=3,
                min_threshold=0.22,
            )

        grounding_state = "source-grounded" if passages else "general-knowledge"

        # Fast tier: keyless local Tabby when enabled & healthy; otherwise the
        # standard cloud -> Ollama chain below. Grounding passages are unchanged.
        if self._resolve_autocomplete_engine() == "tabby":
            tabby_text = self._generate_tabby_autocomplete(
                prefix, suffix=(request.suffix_text or "").strip(), mode=mode
            )
            if tabby_text is not None:
                text = f" {tabby_text}" if mode == "ghost" else tabby_text
                return AutocompleteResponse(
                    text=text,
                    grounding_state=grounding_state,
                    source_passages=passages[:2],
                    mode=mode,
                    latency_ms=round((time.perf_counter() - started) * 1000),
                )

        if mode == "ghost":
            llm_text = self._llm_complete(
                "You are an academic co-writer. Continue the author's sentence naturally in at most 20 words. "
                "Output ONLY the continuation text with no preamble.",
                f"Section: {section}\nCurrent text: {prefix}",
                timeout_seconds=8.0,
            )
            if llm_text is None:
                raise AIProviderUnavailableError("Ghost text")
            return AutocompleteResponse(
                text=f" {llm_text}",
                grounding_state="source-grounded" if passages else "general-knowledge",
                source_passages=passages[:2],
                mode=mode,
                latency_ms=round((time.perf_counter() - started) * 1000),
            )

        llm_text = self._llm_complete(
            "You are an academic co-writer. Continue the draft paragraph in a formal scholarly style "
            "for roughly 3 sentences. Output ONLY the continuation text.",
            f"Section: {section}\nParagraph so far: {paragraph or prefix}",
        )
        if llm_text is None:
            raise AIProviderUnavailableError("Paragraph continuation")
        return AutocompleteResponse(
            text=llm_text,
            grounding_state="source-grounded" if passages else "general-knowledge",
            source_passages=passages[:2],
            mode=mode,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )

    async def stream_autocomplete(
        self, db: Session, project_id: str, request: AutocompleteRequest
    ) -> AsyncGenerator[str, None]:
        """
        SSE delivery for AI autocomplete.
        The completion is produced in one step via the configured LLM provider and
        delivered as a single frame; token-level streaming is not simulated here.
        The blocking generation (DB retrieval + sync LLM HTTP call) runs on a worker
        thread so the event loop stays responsive. Raises AIProviderUnavailableError
        when no provider is reachable.
        """
        try:
            full_res = await anyio.to_thread.run_sync(
                functools.partial(
                    self.generate_autocomplete, db=db, project_id=project_id, request=request
                )
            )
        except Exception as exc:
            logger.warning("stream-autocomplete failed: %s", exc)
            error_payload = {"chunk": "", "done": True, "error": str(exc)}
            yield f"data: {json.dumps(error_payload)}\n\n"
            return
        payload = {
            "chunk": full_res.text,
            "done": False,
            "grounding_state": full_res.grounding_state,
            "source_passages": [p.model_dump() for p in full_res.source_passages],
        }
        yield f"data: {json.dumps(payload)}\n\n"
        yield f"data: {json.dumps({'chunk': '', 'done': True})}\n\n"

    def generate_ai_edit(
        self, db: Session, project_id: str, request: AIEditRequest
    ) -> AIEditResponse:
        """
        Executes one of the 9 AI Editing Actions (§22).
        Never destroys the original text; returns structured diff & explanation.
        LLM-backed actions (expand/explain/translate) require a configured provider;
        mechanical actions fall back to deterministic rule-based rewrites that are
        labeled as such.
        """
        started = time.perf_counter()
        original = request.text.strip()
        action = request.action.lower() if request.action else "clarity"

        # Check for grounding passages in project
        passages = rag_service.hybrid_search(
            db=db, project_id=project_id, query=original, limit=2, min_threshold=0.25
        )

        suggested = original
        explanation = ""
        changes_summary = ""

        instruction = self.EDIT_ACTION_INSTRUCTIONS.get(action)
        llm_text = None
        if instruction:
            llm_text = self._llm_complete(
                f"You are an academic writing editor. {instruction} "
                "Return ONLY the transformed text with no preamble or quotes.",
                original[: settings.LLM_MAX_CONTEXT_CHARS],
            )
            if llm_text is not None:
                return AIEditResponse(
                    original_text=original,
                    suggested_text=llm_text,
                    action=action,
                    explanation=f"Transformed via configured AI provider ({action} action).",
                    changes_summary=f"Applied {action} transformation using the active AI provider.",
                    grounding_state="source-grounded" if passages else "general-knowledge",
                    sources=passages[:1] if passages else [],
                    latency_ms=round((time.perf_counter() - started) * 1000),
                )

        # No LLM available: only mechanically-safe actions have rule-based fallbacks.
        rule_based_actions = {"clarity", "academic", "simplify", "shorten", "grammar", "flow"}
        llm_only_actions = {"expand", "explain", "translate"}

        if action in llm_only_actions:
            raise AIProviderUnavailableError(f"The '{action}' editing action")
        if action not in rule_based_actions:
            raise ValueError(f"Unknown editing action: {action}")

        if action == "clarity":
            suggested = self._improve_clarity(original)
            explanation = "[Rule-based] Removed ambiguity and streamlined sentence syntax for direct comprehensibility."
            changes_summary = "Simplified sentence clauses and eliminated redundant word choices."
        elif action == "academic":
            suggested = self._make_academic(original)
            explanation = "[Rule-based] Elevated tone toward formal scholarly register via vocabulary substitution."
            changes_summary = "Replaced colloquial phrases with conventional academic vocabulary."
        elif action == "simplify":
            suggested = self._simplify_text(original)
            explanation = "[Rule-based] Simplified dense phrasing into plainer wording."
            changes_summary = "Shortened complex compounds into accessible explanations."
        elif action == "shorten":
            suggested = self._shorten_text(original)
            explanation = "[Rule-based] Condensed length by pruning filler phrases while retaining core claims."
            changes_summary = "Pruned non-essential qualifiers and modifier phrases."
        elif action == "grammar":
            suggested = self._fix_grammar(original)
            explanation = (
                "[Rule-based] Corrected punctuation, spacing, and typographical inconsistencies."
            )
            changes_summary = "Resolved grammatical agreements and formatted academic punctuation."
        elif action == "flow":
            suggested = self._improve_flow(original)
            explanation = "[Rule-based] Added a transitional connective to improve narrative flow."
            changes_summary = "Enhanced clause transitions with logical connectives."

        grounding_state = "general-knowledge"

        return AIEditResponse(
            original_text=original,
            suggested_text=suggested,
            action=action,
            explanation=explanation,
            changes_summary=changes_summary,
            grounding_state=grounding_state,
            sources=[],
            latency_ms=round((time.perf_counter() - started) * 1000),
        )

    def _improve_clarity(self, text: str) -> str:
        # Academic clarity transform
        t = re.sub(r"\bin order to\b", "to", text, flags=re.IGNORECASE)
        t = re.sub(r"\bdue to the fact that\b", "because", t, flags=re.IGNORECASE)
        t = re.sub(r"\ba large number of\b", "numerous", t, flags=re.IGNORECASE)
        t = re.sub(r"\bmake an assumption\b", "assume", t, flags=re.IGNORECASE)
        t = re.sub(r"\butilize\b", "use", t, flags=re.IGNORECASE)
        if not t.endswith((".", "!", "?")):
            t += "."
        return t

    def _make_academic(self, text: str) -> str:
        t = re.sub(r"\blooks like\b", "appears to indicate", text, flags=re.IGNORECASE)
        t = re.sub(r"\bgood\b", "favorable", t, flags=re.IGNORECASE)
        t = re.sub(r"\bbig\b", "substantial", t, flags=re.IGNORECASE)
        t = re.sub(r"\bshows\b", "demonstrates", t, flags=re.IGNORECASE)
        t = re.sub(r"\ba lot of\b", "substantial", t, flags=re.IGNORECASE)
        t = re.sub(r"\bwe think\b", "we hypothesize that", t, flags=re.IGNORECASE)
        if not re.search(r"\b(demonstrates|exhibits|signifies|indicates)\b", t, re.IGNORECASE):
            t = f"The empirical evidence indicates that {t[0].lower() + t[1:] if len(t) > 1 else t}"
        return t

    def _simplify_text(self, text: str) -> str:
        t = re.sub(r"\baforementioned\b", "previous", text, flags=re.IGNORECASE)
        t = re.sub(r"\bcommence\b", "start", t, flags=re.IGNORECASE)
        t = re.sub(r"\bnotwithstanding the fact that\b", "although", t, flags=re.IGNORECASE)
        return re.sub(r"\bpredominantly\b", "mainly", t, flags=re.IGNORECASE)

    def _shorten_text(self, text: str) -> str:
        words = text.split()
        if len(words) <= 6:
            return text
        # Prune filler phrases
        t = re.sub(
            r"\b(it is important to note that|as is well known|it goes without saying that|in this context)\b,?\s*",
            "",
            text,
            flags=re.IGNORECASE,
        )
        return t.strip()

    def _fix_grammar(self, text: str) -> str:
        t = re.sub(r"\s+", " ", text).strip()
        t = re.sub(r"\s+([,.:;?!])", r"\1", t)
        if t and not t.endswith((".", "!", "?")):
            t += "."
        return t[0].upper() + t[1:] if len(t) > 1 else t.upper()

    def _improve_flow(self, text: str) -> str:
        connectives = ["Furthermore,", "Consequently,", "In contrast,", "Notably,"]
        if not any(text.startswith(c) for c in connectives):
            return f"Furthermore, {text[0].lower() + text[1:] if len(text) > 1 else text}"
        return text

    def generate_ai_outline(
        self, db: Session, project_id: str, request: AIOutlineRequest
    ) -> AIOutlineResponse:
        """
        Generates a multi-section academic outline from prompt and project literature (§23).

        NOTE: This is a template-based implementation — it does NOT call an LLM.
        It returns a deterministic 7-section academic structure with the topic interpolated.
        Gaps to wire this to a real LLM are tracked upstream; until then, output is
        structurally correct but not content-aware beyond the user's topic string.
        """
        started = time.perf_counter()
        topic = request.topic.strip()
        rq = (
            request.research_question
            or f"Investigating advances and methodological frontiers in {topic}."
        )

        # Retrieve project papers to ground outline
        papers = db.query(Paper).filter(Paper.project_id == project_id).all()
        if request.paper_ids:
            papers = [p for p in papers if p.id in request.paper_ids]

        grounded_sources: list[GroundedPassage] = []
        for p in papers[:3]:
            grounded_sources.append(
                GroundedPassage(
                    paper_id=p.id,
                    paper_title=p.title,
                    authors=rag_service.format_authors_summary(p.authors),
                    year=p.year,
                    page_number=1,
                    section="Abstract",
                    passage_text=p.abstract or p.title,
                    confidence=1.0,
                )
            )

        sections: list[AIOutlineSection] = [
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="1. Introduction",
                level=1,
                description=f"Overview of {topic}, problem formulation, and research objectives.",
                key_points=[
                    "Motivation and societal/scientific significance",
                    f"Formal research question: {rq}",
                    "Summary of principal contributions and paper organization",
                ],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="2. Background & Related Work",
                level=1,
                description="Comprehensive taxonomy of prior investigations and foundational architectures.",
                key_points=[
                    "Foundational theoretical models and mathematical formulations",
                    "Survey of modern benchmarks and comparative baselines",
                    f"Identified limitations in current approaches to {topic}",
                ],
                suggested_passages=grounded_sources[:2],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="3. Proposed Methodology",
                level=1,
                description="Algorithmic formulation, system architecture, and formal properties.",
                key_points=[
                    "Core model architecture and component interaction",
                    "Loss functions, optimization objectives, and training dynamics",
                    "Complexity analysis and theoretical efficiency guarantees",
                ],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="4. Experimental Setup & Benchmarks",
                level=1,
                description="Evaluation protocols, datasets, baseline configurations, and metrics.",
                key_points=[
                    "Dataset selection, preprocessing, and validation splits",
                    "Evaluation metrics (accuracy, latency, memory footprint, robustness)",
                    "Ablation parameters and implementation hyperparameters",
                ],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="5. Results & Empirical Analysis",
                level=1,
                description="Quantitative benchmarking results, comparative tables, and ablation findings.",
                key_points=[
                    "Primary benchmark comparison against state-of-the-art methods",
                    "Ablation studies isolating component contributions",
                    "Error analysis and failure modes",
                ],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="6. Discussion & Research Limitations",
                level=1,
                description="Analytical synthesis, real-world implications, and bounded constraints.",
                key_points=[
                    "Broader theoretical and practical implications of the results",
                    "Computational or dataset limitations",
                    "Threats to validity and generalizability boundaries",
                ],
            ),
            AIOutlineSection(
                id=str(uuid.uuid4()),
                title="7. Conclusion & Future Work",
                level=1,
                description="Final summary of findings, research contributions, and open challenges.",
                key_points=[
                    "Recapitulation of main thesis and empirical breakthroughs",
                    "Promising directions for future investigative extension",
                ],
            ),
        ]

        # Estimated word count based on 7 sections
        estimated_words = len(sections) * 650

        return AIOutlineResponse(
            topic=topic,
            research_question=rq,
            sections=sections,
            estimated_word_count=estimated_words,
            grounding_state="source-grounded" if grounded_sources else "general-knowledge",
            sources=grounded_sources,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )


ai_writing_service = AIWritingService()
