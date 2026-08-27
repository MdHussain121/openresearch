"""Graph schemas."""

from typing import Any

from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    id: str
    label: str
    type: str  # 'paper' | 'author' | 'topic'
    degree: int = 0
    cluster_id: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str  # 'cites' | 'co_authored' | 'shared_topic' | 'similar_embedding'
    weight: float = 1.0


class TopicCluster(BaseModel):
    cluster_id: int
    label: str
    paper_count: int
    keywords: list[str]


class ResearchGraphResponse(BaseModel):
    project_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    total_papers: int
    total_authors: int
    total_topics: int
    clusters: list[TopicCluster]
    bridge_papers: list[str]


class DiscoveryRecommendation(BaseModel):
    id: str
    title: str
    authors: list[str]
    year: int | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    relevance_score: float | None = None
    reason: str
    source_topics: list[str]
