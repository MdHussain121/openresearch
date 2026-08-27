"""RAG & AI Chat schemas."""

from pydantic import BaseModel, Field


class AskPaperAIRequest(BaseModel):
    question: str | None = None
    selected_text: str | None = None
    page_number: int | None = None
    prompt_type: str = "explain"  # 'explain' | 'summarize' | 'findings' | 'custom'


class AskPaperAIResponse(BaseModel):
    answer: str
    prompt_type: str
    grounded: bool = False
    sources: list[str] = Field(default_factory=list)
    insufficient_evidence: bool = False
    source_passage: str | None = None
    page_number: int | None = None


class GroundedPassage(BaseModel):
    paper_id: str
    paper_title: str
    authors: str
    year: int | None = None
    page_number: int = 1
    section: str = "General"
    paragraph: int | None = 1
    passage_text: str
    confidence: float = 1.0
    chunk_id: str | None = None
    score: float | None = None


class GroundedSegment(BaseModel):
    text: str
    grounding_state: str  # 'source-grounded' | 'ai-inference' | 'general-knowledge'
    source_indices: list[int] = Field(default_factory=list)  # 1-based indices into sources array
    attribution_scope: str = "clause"  # 'clause' | 'sentence'


class TrustLegend(BaseModel):
    source_grounded_count: int = 0
    ai_inference_count: int = 0
    general_knowledge_count: int = 0


class ChatMessage(BaseModel):
    role: str  # 'user' | 'assistant' | 'system'
    content: str


class ChatRequest(BaseModel):
    message: str = Field(max_length=32000)
    mode: str = "project"  # 'document' | 'library' | 'project' | 'general'
    paper_id: str | None = None  # When mode == 'document'
    paper_ids: list[str] | None = None  # When mode == 'library'
    conversation_history: list[ChatMessage] | None = None


class ChatResponse(BaseModel):
    answer: str
    mode: str
    grounding_state: str  # 'source-grounded' | 'ai-inference' | 'general-knowledge'
    segments: list[GroundedSegment] = Field(default_factory=list)
    sources: list[GroundedPassage] = Field(default_factory=list)
    trust_legend: TrustLegend
    insufficient_evidence: bool = False
    insufficient_evidence_reason: str | None = None


class RAGSearchRequest(BaseModel):
    query: str = Field(max_length=8000)
    paper_id: str | None = None
    paper_ids: list[str] | None = None
    limit: int = Field(default=5, ge=1, le=50)
    threshold: float = Field(default=0.2, ge=0.0, le=1.0)


class RAGSearchResponse(BaseModel):
    query: str
    total_results: int
    passages: list[GroundedPassage]
