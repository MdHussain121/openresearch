"""Intelligence schemas (claim verification, research gaps, literature matrix, paper review)."""

from datetime import datetime

from pydantic import BaseModel, Field


class ClaimFlagSchema(BaseModel):
    claim_id: str
    text: str
    flag_type: str = "no_supporting_citation"  # 'no_supporting_citation'
    message: str = "No supporting citation detected"
    suggested_query: str
    start_char: int | None = None
    end_char: int | None = None
    is_dismissed: bool = False


class ClaimVerificationRequest(BaseModel):
    document_id: str | None = None
    text: str | None = None
    dismissed_claim_ids: list[str] | None = None


class ClaimVerificationResponse(BaseModel):
    total_claims_analyzed: int
    unsupported_claims_count: int
    dismissed_claims_count: int
    claims: list[ClaimFlagSchema]
    confidence_scoring_status: str = (
        "deferred"  # Confidence scoring intentionally not implemented yet (roadmap 8.1)
    )


class AuthorLimitationSchema(BaseModel):
    paper_id: str
    paper_title: str
    authors: str
    year: int | None = None
    page_number: int = 1
    section: str = "Limitations"
    excerpt: str
    paraphrased_limitation: str


class FutureWorkItemSchema(BaseModel):
    paper_id: str
    paper_title: str
    authors: str
    year: int | None = None
    page_number: int = 1
    section: str = "Future Work"
    excerpt: str
    paraphrased_opportunity: str


class PotentialResearchGapSchema(BaseModel):
    id: str
    title: str
    category: str  # 'dataset' | 'methodology' | 'evaluation' | 'scalability' | 'general'
    description: str
    raw_evidence_count: int
    supporting_papers_count: int
    author_limitations: list[AuthorLimitationSchema] = Field(default_factory=list)
    future_work_quotes: list[FutureWorkItemSchema] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(default_factory=list)


class ResearchGapRequest(BaseModel):
    paper_ids: list[str] | None = None  # If None, all project papers
    focus_topic: str | None = None


class ResearchGapResponse(BaseModel):
    analyzed_papers_count: int
    potential_gaps: list[PotentialResearchGapSchema]
    disclaimer: str = "Potential research gaps based on author limitations and citation analysis. Requires researcher verification."
    confidence_scoring_status: str = (
        "deferred"  # Confidence scoring intentionally not implemented yet (roadmap 8.2)
    )


class LitMatrixCellSchema(BaseModel):
    value: str
    paper_id: str
    paper_title: str
    page_number: int | None = 1
    section: str | None = "Methodology"
    source_excerpt: str | None = None


class LitMatrixRowSchema(BaseModel):
    paper_id: str
    paper_title: str
    authors: str
    year: int | None = None
    doi: str | None = None
    method: LitMatrixCellSchema
    dataset: LitMatrixCellSchema
    results: LitMatrixCellSchema
    limitations: LitMatrixCellSchema


class LitMatrixRequest(BaseModel):
    paper_ids: list[str] | None = None


class LitMatrixResponse(BaseModel):
    headers: list[str] = ["Paper", "Method", "Dataset", "Results", "Limitations"]
    rows: list[LitMatrixRowSchema]
    markdown_table: str
    total_papers: int


class ReviewIssueSchema(BaseModel):
    id: str
    category: str  # 'structure' | 'citations' | 'writing' | 'argumentation' | 'sources'
    severity: str  # 'warning' | 'suggestion' | 'good'
    title: str
    description: str
    flagged_text: str | None = None
    suggestion: str
    suggested_action: str | None = None


class ReviewCategorySummarySchema(BaseModel):
    category: str
    score: int  # 0 - 100
    total_issues: int
    warnings: int
    suggestions: int
    summary_text: str


class PaperReviewRequest(BaseModel):
    document_id: str | None = None
    text: str | None = None
    title: str | None = None


class PaperReviewResponse(BaseModel):
    document_id: str | None = None
    document_title: str
    overall_score: int  # 0 - 100
    categories: dict[str, ReviewCategorySummarySchema]
    issues: list[ReviewIssueSchema]
    analyzed_at: datetime
