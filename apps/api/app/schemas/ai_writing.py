"""AI Writing schemas."""

from pydantic import BaseModel, Field

from app.schemas.rag_chat import GroundedPassage


class AutocompleteRequest(BaseModel):
    prefix_text: str = Field(max_length=32000)
    suffix_text: str | None = None
    paragraph_context: str = ""
    section_heading: str | None = None
    mode: str = "ghost"  # 'ghost' | 'continuation'
    paper_ids: list[str] | None = None


class AutocompleteResponse(BaseModel):
    text: str
    grounding_state: str  # 'source-grounded' | 'ai-inference' | 'general-knowledge'
    source_passages: list[GroundedPassage] = Field(default_factory=list)
    mode: str = "ghost"
    latency_ms: int | None = None


class AutocompleteSettings(BaseModel):
    enabled: bool = True
    engine: str = "auto"  # 'auto' | 'tabby' | 'cloud' | 'ollama'
    base_url: str | None = None
    model: str | None = None


class AutocompleteSettingsUpdate(BaseModel):
    enabled: bool | None = None
    engine: str | None = None
    base_url: str | None = None
    model: str | None = None


class AutocompleteSettingsResponse(AutocompleteSettings):
    pass


class AutocompleteProbeResponse(BaseModel):
    reachable: bool
    base_url: str | None = None


class AIEditRequest(BaseModel):
    text: str = Field(max_length=32000)
    action: str  # 'clarity' | 'academic' | 'simplify' | 'shorten' | 'expand' | 'grammar' | 'flow' | 'translate' | 'explain'
    target_language: str | None = "English"
    paragraph_context: str | None = None
    surrounding_context: str | None = None
    paper_ids: list[str] | None = None


class AIEditResponse(BaseModel):
    original_text: str
    suggested_text: str
    action: str
    explanation: str | None = None
    grounding_state: str = "general-knowledge"
    changes_summary: str | None = None
    sources: list[GroundedPassage] = Field(default_factory=list)
    latency_ms: int | None = None


class AIOutlineSection(BaseModel):
    id: str
    title: str
    level: int = 1
    description: str | None = None
    key_points: list[str] = Field(default_factory=list)
    suggested_passages: list[GroundedPassage] = Field(default_factory=list)


class AIOutlineRequest(BaseModel):
    topic: str
    research_question: str | None = None
    paper_ids: list[str] | None = None
    target_sections_count: int | None = 6
    context_notes: str | None = None


class AIOutlineResponse(BaseModel):
    topic: str
    research_question: str | None = None
    sections: list[AIOutlineSection] = Field(default_factory=list)
    estimated_word_count: int = 4000
    grounding_state: str = "general-knowledge"
    sources: list[GroundedPassage] = Field(default_factory=list)
    latency_ms: int | None = None
