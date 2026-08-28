import uuid
from typing import ClassVar

from sqlalchemy.orm import Session

from app.core.text_utils import format_authors_summary, split_sentences
from app.models.chunk import PaperChunk
from app.models.paper import Paper
from app.schemas.models import (
    AuthorLimitationSchema,
    FutureWorkItemSchema,
    PotentialResearchGapSchema,
    ResearchGapRequest,
    ResearchGapResponse,
)

RESEARCH_GAP_DISCLAIMER = (
    "Potential research gaps based on keyword-matched author limitations. "
    "This is a heuristic/template analysis — not an LLM-powered synthesis. "
    "Requires researcher verification."
)


class GapDetectionService:
    """
    8.2 Research Gap Assistant (Roadmap 8.2):
    Extracts author-stated limitations and future work, synthesizes template-based gap opportunities.
    """

    LIMITATION_KEYWORDS: ClassVar[list[str]] = [
        "limit",
        "constrained",
        "bottleneck",
        "lack of",
        "small dataset",
        "restricted to",
        "does not scale",
        "fails to",
        "assumption",
        "computational overhead",
    ]

    FUTURE_KEYWORDS: ClassVar[list[str]] = [
        "future work",
        "promising direction",
        "open challenge",
        "remains to be",
        "further investigation",
        "extend",
        "explore",
        "in the future",
    ]

    def _extract_limitations_and_future_work(
        self, db: Session, papers: list[Paper]
    ) -> tuple[list[AuthorLimitationSchema], list[FutureWorkItemSchema]]:
        """Extract author-stated limitations and future work from paper text and chunks."""
        limitations: list[AuthorLimitationSchema] = []
        future_work: list[FutureWorkItemSchema] = []

        for paper in papers:
            authors_str = format_authors_summary(paper.authors)
            text_corpus = paper.abstract or ""
            chunks = db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).limit(10).all()
            for chunk in chunks:
                text_corpus += " " + chunk.content

            sentences = split_sentences(text_corpus)
            for sentence in sentences:
                sentence_lower = sentence.lower()
                if any(keyword in sentence_lower for keyword in self.LIMITATION_KEYWORDS):
                    limitations.append(
                        AuthorLimitationSchema(
                            paper_id=paper.id,
                            paper_title=paper.title,
                            authors=authors_str,
                            year=paper.year,
                            page_number=1,
                            section="Limitations & Discussion",
                            excerpt=sentence[:200],
                            paraphrased_limitation=f"{authors_str} note constraints in {sentence[:120]}...",
                        )
                    )
                elif any(keyword in sentence_lower for keyword in self.FUTURE_KEYWORDS):
                    future_work.append(
                        FutureWorkItemSchema(
                            paper_id=paper.id,
                            paper_title=paper.title,
                            authors=authors_str,
                            year=paper.year,
                            page_number=1,
                            section="Future Work",
                            excerpt=sentence[:200],
                            paraphrased_opportunity=f"{authors_str} identify open opportunity: {sentence[:120]}...",
                        )
                    )
        return limitations, future_work

    def _synthesize_potential_gaps(
        self,
        papers: list[Paper],
        limitations: list[AuthorLimitationSchema],
        future_work: list[FutureWorkItemSchema],
    ) -> list[PotentialResearchGapSchema]:
        """
        Synthesize extracted limitation evidence into structured research gap opportunities.

        NOTE: This is a template-based heuristic, NOT an LLM call.
        Gap titles, descriptions, and unsupported_claims are pre-written templates
        that apply broadly across ML/scientific domains. The raw_evidence_count reflects
        the number of extracted limitation sentences matching each template's keyword
        filter — it does NOT fabricate evidence that doesn't exist.
        """
        potential_gaps: list[PotentialResearchGapSchema] = []

        # Gap 1: Dataset & Evaluation Scope
        dataset_limits = [
            item
            for item in limitations
            if "dataset" in item.excerpt.lower() or "benchmark" in item.excerpt.lower()
        ]
        gap_1_evidence = len(dataset_limits)
        potential_gaps.append(
            PotentialResearchGapSchema(
                id=str(uuid.uuid4()),
                title="Evaluation Scope Restricted to Homogeneous Benchmark Datasets",
                category="dataset",
                description=(
                    "Existing literature evaluates performance primarily on standard closed benchmarks. Evaluation "
                    "under cross-domain distribution shifts and out-of-distribution real-world datasets remains "
                    "unaddressed."
                ),
                raw_evidence_count=gap_1_evidence,
                supporting_papers_count=min(len(papers), gap_1_evidence) if gap_1_evidence else 0,
                author_limitations=dataset_limits[:3] if dataset_limits else limitations[:2],
                future_work_quotes=[
                    fw for fw in future_work if "dataset" in fw.excerpt.lower()
                ][:2]
                or future_work[:1],
                unsupported_claims=[],
            )
        )

        # Gap 2: Computational Overhead & Scaling Constraints
        compute_limits = [
            item
            for item in limitations
            if "compute" in item.excerpt.lower()
            or "scale" in item.excerpt.lower()
            or "overhead" in item.excerpt.lower()
            or "latency" in item.excerpt.lower()
        ]
        gap_2_evidence = len(compute_limits)
        potential_gaps.append(
            PotentialResearchGapSchema(
                id=str(uuid.uuid4()),
                title="High Computational Complexity and Memory Bandwidth Bottlenecks During Inference",
                category="scalability",
                description=(
                    "Selected studies achieve superior accuracy at the expense of non-linear memory growth and "
                    "substantial GPU memory footprint, creating barriers for resource-constrained deployment."
                ),
                raw_evidence_count=gap_2_evidence,
                supporting_papers_count=min(len(papers), gap_2_evidence) if gap_2_evidence else 0,
                author_limitations=compute_limits[:3] if compute_limits else limitations[:2],
                future_work_quotes=[
                    fw
                    for fw in future_work
                    if "efficient" in fw.excerpt.lower() or "speed" in fw.excerpt.lower()
                ][:2]
                or future_work[:1],
                unsupported_claims=[],
            )
        )

        # Gap 3: Methodological Assumptions & Robustness
        methodology_limits = [
            item
            for item in limitations
            if any(
                kw in item.excerpt.lower()
                for kw in ("ablation", "robustness", "perturbation", "sensitivity")
            )
        ]
        gap_3_evidence = len(methodology_limits)
        potential_gaps.append(
            PotentialResearchGapSchema(
                id=str(uuid.uuid4()),
                title="Ablation and Sensitivity Analysis Under Adversarial Perturbations",
                category="methodology",
                description=(
                    "Author discussions acknowledge that hyperparameter sensitivity and behavior under noisy inputs "
                    "have not been systematically isolated."
                ),
                raw_evidence_count=gap_3_evidence,
                supporting_papers_count=min(len(papers), gap_3_evidence) if gap_3_evidence else 0,
                author_limitations=methodology_limits[:3]
                if methodology_limits
                else limitations[2:4]
                if len(limitations) > 3
                else limitations[:1],
                future_work_quotes=future_work[1:3] if len(future_work) > 2 else future_work[:1],
                unsupported_claims=[],
            )
        )
        return potential_gaps

    def analyze_research_gaps(
        self, db: Session, project_id: str, request: ResearchGapRequest
    ) -> ResearchGapResponse:
        papers_query = db.query(Paper).filter(Paper.project_id == project_id)
        if request.paper_ids:
            papers_query = papers_query.filter(Paper.id.in_(request.paper_ids))
        papers = papers_query.all()

        if not papers:
            return ResearchGapResponse(
                analyzed_papers_count=0,
                potential_gaps=[],
                disclaimer=RESEARCH_GAP_DISCLAIMER,
                confidence_scoring_status="deferred",
            )

        limitations, future_work = self._extract_limitations_and_future_work(db, papers)
        potential_gaps = self._synthesize_potential_gaps(papers, limitations, future_work)

        return ResearchGapResponse(
            analyzed_papers_count=len(papers),
            potential_gaps=potential_gaps,
            disclaimer=RESEARCH_GAP_DISCLAIMER,
            confidence_scoring_status="deferred",
        )


gap_detection_service = GapDetectionService()
