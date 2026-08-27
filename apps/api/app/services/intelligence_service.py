import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import ClassVar

from sqlalchemy.orm import Session

from app.core.text_utils import (
    format_authors_summary,
    sanitize_surrogates,
    split_sentences,
)
from app.models.chunk import PaperChunk
from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.schemas.models import (
    AuthorLimitationSchema,
    ClaimFlagSchema,
    ClaimVerificationRequest,
    ClaimVerificationResponse,
    FutureWorkItemSchema,
    LitMatrixCellSchema,
    LitMatrixRequest,
    LitMatrixResponse,
    LitMatrixRowSchema,
    PaperReviewRequest,
    PaperReviewResponse,
    PotentialResearchGapSchema,
    ResearchGapRequest,
    ResearchGapResponse,
    ReviewCategorySummarySchema,
    ReviewIssueSchema,
)

RESEARCH_GAP_DISCLAIMER = (
    "Potential research gaps based on keyword-matched author limitations. "
    "This is a heuristic/template analysis — not an LLM-powered synthesis. "
    "Requires researcher verification."
)


class IntelligenceService:
    """
    Advanced Research Intelligence Service (Phase 8):
    - 8.1 Claim Verification (v1 mechanical check, zero-citation detection, confidence deferred)
    - 8.2 Research Gap Assistant (author limitations, future work, raw evidence, confidence deferred)
    - 8.3 Literature Review Matrix (multi-paper matrix with cell-level source references)
    - 8.4 Research Paper Review Engine (5 dimensions: Structure, Citations, Writing, Argumentation, Sources)
    """

    # ----------------------------------------------------------------------
    # 8.1 Claim Verification Engine (Roadmap 8.1)
    # ----------------------------------------------------------------------
    def verify_claims(
        self, db: Session, project_id: str, request: ClaimVerificationRequest
    ) -> ClaimVerificationResponse:
        text = ""
        dismissed_set = set(request.dismissed_claim_ids or [])

        if request.document_id:
            doc = db.query(Document).filter(Document.id == request.document_id).first()
            if doc:
                text = doc.plain_text or ""
        elif request.text:
            text = request.text

        text = sanitize_surrogates(text)

        if not text.strip():
            return ClaimVerificationResponse(
                total_claims_analyzed=0,
                unsupported_claims_count=0,
                dismissed_claims_count=0,
                claims=[],
                confidence_scoring_status="deferred",
            )

        # Split text into sentences
        raw_sentences = [
            sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text) if sentence.strip()
        ]

        claims: list[ClaimFlagSchema] = []
        unsupported_count = 0
        dismissed_count = 0

        # Heuristic keywords indicating factual/empirical assertions
        claim_markers = [
            "improve",
            "increase",
            "decrease",
            "reduce",
            "achieve",
            "outperform",
            "show",
            "demonstrate",
            "state",
            "indicate",
            "require",
            "propose",
            "leads to",
            "resulting in",
            "accuracy",
            "latency",
            "benchmark",
            "model",
            "transformer",
            "neural",
            "dataset",
            "percent",
            "%",
            "faster",
            "higher",
            "lower",
            "significant",
            "superior",
        ]

        # Citation patterns: [1], (Author et al., 2020), (Author, 2018), @citation
        citation_pattern = re.compile(
            r"(\[\d+\]|\([A-Za-z\s]+(?:et\sal\.)?,?\s*\d{4}\)|@citation|\b(?:Vaswani|Devlin|Brown|He)\set\sal\.)"
        )

        char_offset = 0
        for sent in raw_sentences:
            start_char = text.find(sent, char_offset)
            end_char = start_char + len(sent) if start_char != -1 else None
            if start_char != -1 and end_char is not None:
                char_offset = end_char

            # Ignore short phrases or headings
            if len(sent.split()) < 4 or sent.startswith("#") or sent.endswith(":"):
                continue

            sent_lower = sent.lower()
            is_potential_claim = any(marker in sent_lower for marker in claim_markers)

            if is_potential_claim:
                has_citation = bool(citation_pattern.search(sent))

                # If no supporting citation detected in sentence
                if not has_citation:
                    # Create deterministic claim ID from sentence text
                    claim_id = hashlib.md5(sent.encode("utf-8")).hexdigest()[:12]
                    is_dismissed = claim_id in dismissed_set

                    # Generate targeted search query from keywords
                    words = [
                        w.strip(".,;:()\"'")
                        for w in sent.split()
                        if len(w) > 3
                        and w.lower()
                        not in [
                            "this",
                            "that",
                            "these",
                            "those",
                            "their",
                            "which",
                            "there",
                            "where",
                            "about",
                            "could",
                            "would",
                            "should",
                        ]
                    ]
                    suggested_query = " ".join(words[:5])

                    flag = ClaimFlagSchema(
                        claim_id=claim_id,
                        text=sent,
                        flag_type="no_supporting_citation",
                        message="No supporting citation detected",
                        suggested_query=suggested_query,
                        start_char=start_char,
                        end_char=end_char,
                        is_dismissed=is_dismissed,
                    )
                    claims.append(flag)

                    if is_dismissed:
                        dismissed_count += 1
                    else:
                        unsupported_count += 1

        return ClaimVerificationResponse(
            total_claims_analyzed=len(claims),
            unsupported_claims_count=unsupported_count,
            dismissed_claims_count=dismissed_count,
            claims=claims,
            confidence_scoring_status="deferred",
        )

    # ----------------------------------------------------------------------
    # 8.2 Research Gap Assistant (Roadmap 8.2)
    # ----------------------------------------------------------------------
    def _extract_limitations_and_future_work(
        self, db: Session, papers: list[Paper]
    ) -> tuple[list[AuthorLimitationSchema], list[FutureWorkItemSchema]]:
        """Extract author-stated limitations and future work from paper text and chunks."""
        limitations: list[AuthorLimitationSchema] = []
        future_work: list[FutureWorkItemSchema] = []

        limitation_keywords = [
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
        future_keywords = [
            "future work",
            "promising direction",
            "open challenge",
            "remains to be",
            "further investigation",
            "extend",
            "explore",
            "in the future",
        ]

        for paper in papers:
            authors_str = format_authors_summary(paper.authors)
            text_corpus = paper.abstract or ""
            chunks = db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).limit(10).all()
            for chunk in chunks:
                text_corpus += " " + chunk.content

            sentences = split_sentences(text_corpus)
            for sentence in sentences:
                sentence_lower = sentence.lower()
                if any(keyword in sentence_lower for keyword in limitation_keywords):
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
                elif any(keyword in sentence_lower for keyword in future_keywords):
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

        NOTE (audit-11 H-3): This is a template-based heuristic, NOT an LLM call.
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
                future_work_quotes=[fw for fw in future_work if "dataset" in fw.excerpt.lower()][:2]
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

    # ----------------------------------------------------------------------
    # 8.3 Literature Review Matrix (Roadmap 8.3)
    # ----------------------------------------------------------------------
    # Dimension keyword sets for literature-matrix cell extraction from real paper text
    _MATRIX_DIMENSIONS: ClassVar[dict[str, list[str]]] = {
        "method": [
            "we propose",
            "we introduce",
            "we present",
            "we describe",
            "our method",
            "our approach",
            "architecture",
            "framework",
            "algorithm",
            "model consists",
        ],
        "dataset": [
            "dataset",
            "benchmark",
            "corpus",
            "we evaluate on",
            "experiments on",
            "trained on",
            "test set",
            "validation set",
            "collected",
        ],
        "results": [
            "results show",
            "we find that",
            "outperform",
            "improves",
            "achieves",
            "accuracy of",
            "score of",
            "state-of-the-art",
            "significant improvement",
            "f1",
            "bleu",
        ],
    }
    _NOT_STATED = "Not stated in extracted text"

    @staticmethod
    def _first_matching_sentence(
        chunks: list[PaperChunk], keywords: list[str]
    ) -> tuple[str | None, int | None, str | None]:
        """Scan a paper's real chunks (in reading order) for the first sentence matching any keyword."""
        ordered = sorted(chunks, key=lambda c: (c.page_number, c.paragraph))
        for chunk in ordered:
            content = chunk.content or ""
            if not content:
                continue
            for sentence in split_sentences(content):
                s_lower = sentence.lower()
                if len(sentence.split()) < 6:
                    continue
                if any(k in s_lower for k in keywords):
                    excerpt = sentence.strip()
                    return (
                        excerpt[:280] + ("..." if len(excerpt) > 280 else ""),
                        chunk.page_number,
                        chunk.section,
                    )
        return None, None, None

    def generate_literature_matrix(
        self, db: Session, project_id: str, request: LitMatrixRequest
    ) -> LitMatrixResponse:
        papers_query = db.query(Paper).filter(Paper.project_id == project_id)
        if request.paper_ids:
            papers_query = papers_query.filter(Paper.id.in_(request.paper_ids))
        papers = papers_query.all()

        rows: list[LitMatrixRowSchema] = []

        for paper in papers:
            authors_str = paper.primary_author_name
            if paper.authors and len(paper.authors) > 1:
                authors_str += " et al."

            chunks = (
                db.query(PaperChunk)
                .filter(PaperChunk.paper_id == paper.id)
                .order_by(PaperChunk.page_number.asc(), PaperChunk.paragraph.asc())
                .all()
            )

            def make_cell(
                current_paper: Paper,
                current_chunks: list[PaperChunk],
                keywords: list[str],
            ) -> LitMatrixCellSchema:
                value, page_number, section = self._first_matching_sentence(
                    current_chunks, keywords
                )
                if value is None:
                    return LitMatrixCellSchema(
                        value=self._NOT_STATED,
                        paper_id=current_paper.id,
                        paper_title=current_paper.title,
                        page_number=None,
                        section=None,
                        source_excerpt=None,
                    )
                return LitMatrixCellSchema(
                    value=value,
                    paper_id=current_paper.id,
                    paper_title=current_paper.title,
                    page_number=page_number,
                    section=section,
                    source_excerpt=f"{current_paper.title} — {section or 'General'}, p.{page_number}: “{value[:160]}”",
                )

            method_cell = make_cell(paper, chunks, self._MATRIX_DIMENSIONS["method"])
            dataset_cell = make_cell(paper, chunks, self._MATRIX_DIMENSIONS["dataset"])
            results_cell = make_cell(paper, chunks, self._MATRIX_DIMENSIONS["results"])

            limitations_keywords = [
                "limitation",
                "constrained",
                "bottleneck",
                "lack of",
                "restricted to",
                "does not scale",
                "fails to",
                "assumption",
                "computational overhead",
                "future work",
            ]
            lim_value, lim_page, lim_section = self._first_matching_sentence(
                chunks, limitations_keywords
            )
            if lim_value is None:
                limitations_cell = LitMatrixCellSchema(
                    value=self._NOT_STATED,
                    paper_id=paper.id,
                    paper_title=paper.title,
                    page_number=None,
                    section=None,
                    source_excerpt=None,
                )
            else:
                limitations_cell = LitMatrixCellSchema(
                    value=lim_value,
                    paper_id=paper.id,
                    paper_title=paper.title,
                    page_number=lim_page,
                    section=lim_section,
                    source_excerpt=f"{paper.title} — {lim_section or 'General'}, p.{lim_page}: “{lim_value[:160]}”",
                )

            row = LitMatrixRowSchema(
                paper_id=paper.id,
                paper_title=paper.title,
                authors=authors_str,
                year=paper.year,
                doi=paper.doi,
                method=method_cell,
                dataset=dataset_cell,
                results=results_cell,
                limitations=limitations_cell,
            )
            rows.append(row)

        # Generate markdown table string
        md_lines = ["| Paper | Method | Dataset | Results | Limitations |", "|---|---|---|---|---|"]
        for r in rows:
            year_str = f" ({r.year})" if r.year else ""
            paper_col = f"**{r.authors}{year_str}**<br>_{r.paper_title}_"
            md_lines.append(
                f"| {paper_col} | {r.method.value} | {r.dataset.value} | {r.results.value} | {r.limitations.value} |"
            )

        markdown_table = "\n".join(md_lines)

        return LitMatrixResponse(
            headers=["Paper", "Method", "Dataset", "Results", "Limitations"],
            rows=rows,
            markdown_table=markdown_table,
            total_papers=len(rows),
        )

    # ----------------------------------------------------------------------
    # 8.4 Research Paper Review Engine (Roadmap 8.4)
    # ----------------------------------------------------------------------
    def review_paper(
        self, db: Session, project_id: str, request: PaperReviewRequest
    ) -> PaperReviewResponse:
        text = ""
        doc_title = request.title or "Untitled Research Draft"

        if request.document_id:
            doc = db.query(Document).filter(Document.id == request.document_id).first()
            if doc:
                text = doc.plain_text or ""
                doc_title = doc.title or doc_title
        elif request.text:
            text = request.text

        text = sanitize_surrogates(text)

        issues: list[ReviewIssueSchema] = []

        # 1. Structure Dimension (§24)
        structure_issues: list[ReviewIssueSchema] = []
        text_lower = text.lower()
        expected_sections = [
            ("Introduction", ["introduction", "overview", "background"]),
            ("Methodology", ["method", "methodology", "approach", "architecture", "system"]),
            ("Results / Evaluation", ["results", "evaluation", "experiments", "performance"]),
            ("Discussion / Limitations", ["discussion", "limitations", "threats to validity"]),
            ("Conclusion", ["conclusion", "concluding remarks", "summary"]),
        ]

        missing_sections = []
        for sec_name, keywords in expected_sections:
            if not any(k in text_lower for k in keywords):
                missing_sections.append(sec_name)

        if missing_sections:
            iss = ReviewIssueSchema(
                id=str(uuid.uuid4()),
                category="structure",
                severity="warning",
                title=f"Missing standard academic sections: {', '.join(missing_sections)}",
                description=(
                    "Academic research manuscripts typically require explicit sections for reproducible exposition."
                ),
                suggestion=f"Add structured headings for: {', '.join(missing_sections)}.",
                suggested_action="Insert section templates",
            )
            structure_issues.append(iss)
            issues.append(iss)

        # 2. Citations Dimension (§24)
        citation_issues: list[ReviewIssueSchema] = []
        claim_res = self.verify_claims(
            db=db, project_id=project_id, request=ClaimVerificationRequest(text=text)
        )
        if claim_res.unsupported_claims_count > 0:
            for claim in claim_res.claims[:3]:
                if not claim.is_dismissed:
                    issue = ReviewIssueSchema(
                        id=str(uuid.uuid4()),
                        category="citations",
                        severity="warning",
                        title="Unsupported empirical assertion",
                        description="Sentence makes an empirical assertion without an explicit supporting reference.",
                        flagged_text=claim.text,
                        suggestion=(
                            f"Attach a grounded source reference or query your library: '{claim.suggested_query}'."
                        ),
                        suggested_action="Search citation",
                    )
                    citation_issues.append(issue)
                    issues.append(issue)

        # 3. Writing Dimension (§24)
        writing_issues: list[ReviewIssueSchema] = []
        sentences = [
            sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text) if sentence.strip()
        ]
        for sentence in sentences:
            if len(sentence.split()) > 35:
                issue = ReviewIssueSchema(
                    id=str(uuid.uuid4()),
                    category="writing",
                    severity="suggestion",
                    title="Convoluted sentence length (>35 words)",
                    description="Very long sentences reduce academic reading comprehension and clarity.",
                    flagged_text=sentence[:120] + "...",
                    suggestion="Split into two concise sentences focusing on one central claim per clause.",
                    suggested_action="Improve clarity",
                )
                writing_issues.append(issue)
                issues.append(issue)
                break

        # 4. Argumentation Dimension (§24)
        argumentation_issues: list[ReviewIssueSchema] = []
        unhedged_words = [
            "always",
            "never",
            "obviously",
            "proves",
            "undoubtedly",
            "flawless",
            "impossible",
        ]
        for sentence in sentences:
            found_unhedged = [w for w in unhedged_words if f" {w} " in f" {sentence.lower()} "]
            if found_unhedged:
                issue = ReviewIssueSchema(
                    id=str(uuid.uuid4()),
                    category="argumentation",
                    severity="warning",
                    title=f"Unhedged absolute assertion ('{found_unhedged[0]}')",
                    description=(
                        "Academic argumentation requires calibrated hedging (e.g., 'substantially demonstrates', "
                        "'strongly suggests') rather than unhedged absolutes."
                    ),
                    flagged_text=sentence[:120] + "...",
                    suggestion=f"Replace '{found_unhedged[0]}' with nuanced academic qualifiers.",
                    suggested_action="Make academic",
                )
                argumentation_issues.append(issue)
                issues.append(issue)
                break

        # 5. Sources Dimension (§24)
        sources_issues: list[ReviewIssueSchema] = []
        citations = []
        if request.document_id:
            citations = db.query(Citation).filter(Citation.document_id == request.document_id).all()

        if not citations and len(sentences) > 5:
            iss = ReviewIssueSchema(
                id=str(uuid.uuid4()),
                category="sources",
                severity="warning",
                title="Low overall citation density",
                description=(
                    "Manuscript contains substantial narrative text with zero bibliography references attached."
                ),
                suggestion="Use '@' in the editor to integrate literature references across key claims.",
                suggested_action="Add citations",
            )
            sources_issues.append(iss)
            issues.append(iss)

        # Compute category scores
        categories = {
            "structure": ReviewCategorySummarySchema(
                category="structure",
                score=max(50, 100 - len(structure_issues) * 20),
                total_issues=len(structure_issues),
                warnings=len([i for i in structure_issues if i.severity == "warning"]),
                suggestions=len([i for i in structure_issues if i.severity == "suggestion"]),
                summary_text="Section organizational completeness and flow.",
            ),
            "citations": ReviewCategorySummarySchema(
                category="citations",
                score=max(45, 100 - len(citation_issues) * 15),
                total_issues=len(citation_issues),
                warnings=len([i for i in citation_issues if i.severity == "warning"]),
                suggestions=len([i for i in citation_issues if i.severity == "suggestion"]),
                summary_text="Source backing and empirical claim verification.",
            ),
            "writing": ReviewCategorySummarySchema(
                category="writing",
                score=max(60, 100 - len(writing_issues) * 10),
                total_issues=len(writing_issues),
                warnings=len([i for i in writing_issues if i.severity == "warning"]),
                suggestions=len([i for i in writing_issues if i.severity == "suggestion"]),
                summary_text="Clarity, sentence length, and academic register.",
            ),
            "argumentation": ReviewCategorySummarySchema(
                category="argumentation",
                score=max(55, 100 - len(argumentation_issues) * 15),
                total_issues=len(argumentation_issues),
                warnings=len([i for i in argumentation_issues if i.severity == "warning"]),
                suggestions=len([i for i in argumentation_issues if i.severity == "suggestion"]),
                summary_text="Hedging, logical qualifiers, and balanced conclusions.",
            ),
            "sources": ReviewCategorySummarySchema(
                category="sources",
                score=max(50, 100 - len(sources_issues) * 25),
                total_issues=len(sources_issues),
                warnings=len([i for i in sources_issues if i.severity == "warning"]),
                suggestions=len([i for i in sources_issues if i.severity == "suggestion"]),
                summary_text="Citation diversity, currency, and bibliography depth.",
            ),
        }

        overall_score = round(sum(cat.score for cat in categories.values()) / len(categories))

        return PaperReviewResponse(
            document_id=request.document_id,
            document_title=doc_title,
            overall_score=overall_score,
            categories=categories,
            issues=issues,
            analyzed_at=datetime.now(UTC),
        )


intelligence_service = IntelligenceService()
