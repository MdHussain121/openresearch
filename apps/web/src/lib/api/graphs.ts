import { request } from './client';

export interface GraphNodeDTO {
  id: string;
  label: string;
  type: 'paper' | 'author' | 'topic' | string;
  paper_id?: string;
  author_name?: string;
  topic_name?: string;
  degree?: number;
  cluster_id?: number;
  year?: number;
  citation_count?: number;
  metadata?: Record<string, any>;
  x?: number;
  y?: number;
}

export interface GraphEdgeDTO {
  source: string;
  target: string;
  relationship?: string;
  type?: string;
  weight?: number;
}

export interface GraphClusterDTO {
  id?: number;
  cluster_id?: number;
  label: string;
  size?: number;
  paper_count?: number;
  color?: string;
  keywords?: string[];
}

export interface ResearchGraphDTO {
  project_id: string;
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  total_papers: number;
  total_authors: number;
  total_topics: number;
  clusters: GraphClusterDTO[];
  bridge_papers: string[];
}

export interface RelatedPaperDTO {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  similarity_score: number;
  relevance_score?: number | null;
  reason?: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  citation_count?: number;
}

export const graphsApi = {
  getResearchGraph: (projectId: string) =>
    request<ResearchGraphDTO>(`/projects/${projectId}/research-graph`),
  discoverRelated: (projectId: string) =>
    request<RelatedPaperDTO[]>(`/projects/${projectId}/discover-related`),
};
