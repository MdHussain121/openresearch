import asyncio
import hashlib
import logging
import re
from collections import defaultdict
from typing import Any
from urllib.parse import quote_plus

from sqlalchemy.orm import Session

from app.core.constants import STOP_WORDS
from app.core.http_client import get_async_http_client
from app.models.paper import Paper
from app.schemas.models import (
    DiscoveryRecommendation,
    GraphEdge,
    GraphNode,
    ResearchGraphResponse,
    TopicCluster,
)

logger = logging.getLogger("openresearch.graphs")


def _safe_list_of_dicts(value: Any) -> list[dict[str, Any]]:
    """Coerce a JSON column value to list[dict], discarding non-dict elements."""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


def extract_keywords_from_text(text: str, max_keywords: int = 5) -> list[str]:
    if not text:
        return []
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    freq: dict[str, int] = defaultdict(int)
    for w in words:
        if w not in STOP_WORDS:
            freq[w] += 1
    sorted_keywords = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    return [k for k, _ in sorted_keywords[:max_keywords]]


class ResearchGraphService:
    @staticmethod
    def build_project_graph(db: Session, project_id: str) -> ResearchGraphResponse:
        papers: list[Paper] = db.query(Paper).filter(Paper.project_id == project_id).all()

        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []
        degrees: dict[str, int] = defaultdict(int)

        paper_nodes_map: dict[str, GraphNode] = {}
        author_nodes_map: dict[str, GraphNode] = {}
        topic_nodes_map: dict[str, GraphNode] = {}

        paper_topics: dict[str, list[str]] = {}

        # 1. Build Paper Nodes
        for p in papers:
            p_node = GraphNode(
                id=f"paper:{p.id}",
                label=p.title or "Untitled Paper",
                type="paper",
                metadata={
                    "paper_id": p.id,
                    "doi": p.doi,
                    "arxiv_id": p.arxiv_id,
                    "year": p.year,
                    "extraction_status": p.extraction_status,
                    "abstract": p.abstract[:200] + "..."
                    if p.abstract and len(p.abstract) > 200
                    else (p.abstract or ""),
                    "author_names": [
                        a.get("name") if isinstance(a, dict) else str(a) for a in (p.authors or [])
                    ],
                },
            )
            nodes.append(p_node)
            paper_nodes_map[p.id] = p_node

            # Extract topics from title + abstract
            combined_text = f"{p.title or ''} {p.abstract or ''}"
            keywords = extract_keywords_from_text(combined_text, max_keywords=4)
            paper_topics[p.id] = keywords

        # 2. Build Author Nodes & Co-authorship / Authored-by edges
        for p in papers:
            if not p.authors:
                continue
            author_names = [
                str(a.get("name") or "") if isinstance(a, dict) else str(a) for a in p.authors
            ]
            for a_name in author_names:
                a_name_clean = a_name.strip()
                if not a_name_clean:
                    continue
                a_id = f"author:{a_name_clean.lower().replace(' ', '_')}"
                if a_id not in author_nodes_map:
                    a_node = GraphNode(
                        id=a_id,
                        label=a_name_clean,
                        type="author",
                        metadata={"name": a_name_clean, "papers_count": 0},
                    )
                    author_nodes_map[a_id] = a_node
                    nodes.append(a_node)

                author_nodes_map[a_id].metadata["papers_count"] += 1

                # Edge: Author -> Paper
                edge = GraphEdge(
                    source=a_id, target=f"paper:{p.id}", type="co_authored", weight=1.0
                )
                edges.append(edge)
                degrees[a_id] += 1
                degrees[f"paper:{p.id}"] += 1

        # 3. Build Topic Nodes & Shared Topic Edges
        topic_paper_map: dict[str, list[str]] = defaultdict(list)
        for p_id, topics in paper_topics.items():
            for t in topics:
                t_id = f"topic:{t}"
                topic_paper_map[t].append(p_id)
                if t_id not in topic_nodes_map:
                    t_node = GraphNode(
                        id=t_id,
                        label=t.capitalize(),
                        type="topic",
                        metadata={"keyword": t, "paper_count": 0},
                    )
                    topic_nodes_map[t_id] = t_node
                    nodes.append(t_node)

                topic_nodes_map[t_id].metadata["paper_count"] += 1

                # Edge: Paper -> Topic
                edge = GraphEdge(
                    source=f"paper:{p_id}", target=t_id, type="shared_topic", weight=1.0
                )
                edges.append(edge)
                degrees[f"paper:{p_id}"] += 1
                degrees[t_id] += 1

        # 4. Cross-paper citation links & title references
        for p1 in papers:
            meta = p1.metadata_json or {}
            refs = _safe_list_of_dicts(meta.get("references"))
            for ref in refs:
                ref_title = (ref.get("title") or "").lower().strip()
                ref_doi = (ref.get("doi") or "").lower().strip()
                for p2 in papers:
                    if p1.id == p2.id:
                        continue
                    if (ref_doi and p2.doi and ref_doi == p2.doi.lower().strip()) or (
                        ref_title
                        and p2.title
                        and len(ref_title) > 10
                        and ref_title in p2.title.lower()
                    ):
                        edges.append(
                            GraphEdge(
                                source=f"paper:{p1.id}",
                                target=f"paper:{p2.id}",
                                type="cites",
                                weight=2.0,
                            )
                        )
                        degrees[f"paper:{p1.id}"] += 1
                        degrees[f"paper:{p2.id}"] += 1

        # 5. Form Topic Clusters
        clusters: list[TopicCluster] = []
        sorted_topics = sorted(topic_paper_map.items(), key=lambda x: len(x[1]), reverse=True)
        assigned_papers = set()
        cluster_idx = 1

        for top_topic, p_ids in sorted_topics[:5]:
            unique_pids = [pid for pid in p_ids if pid not in assigned_papers]
            if not unique_pids and p_ids:
                unique_pids = p_ids

            cluster = TopicCluster(
                cluster_id=cluster_idx,
                label=f"{top_topic.capitalize()} Research Domain",
                paper_count=len(unique_pids),
                keywords=[
                    top_topic,
                    *[
                        t
                        for pid in unique_pids
                        for t in paper_topics.get(pid, [])
                        if t != top_topic
                    ][:4],
                ],
            )
            clusters.append(cluster)

            for pid in unique_pids:
                assigned_papers.add(pid)
                if pid in paper_nodes_map:
                    paper_nodes_map[pid].cluster_id = cluster_idx
            cluster_idx += 1

        # 6. Compute Degree Centrality and Bridge Papers
        for n in nodes:
            n.degree = degrees.get(n.id, 0)

        # Bridge papers: papers that connect multiple topic clusters or have highest degrees
        bridge_papers = [
            p.title
            for p in sorted(papers, key=lambda x: degrees.get(f"paper:{x.id}", 0), reverse=True)[:3]
            if p.title
        ]

        return ResearchGraphResponse(
            project_id=project_id,
            nodes=nodes,
            edges=edges,
            total_papers=len(papers),
            total_authors=len(author_nodes_map),
            total_topics=len(topic_nodes_map),
            clusters=clusters,
            bridge_papers=bridge_papers,
        )

    @staticmethod
    async def discover_related_work(db: Session, project_id: str) -> list[DiscoveryRecommendation]:
        """
        Queries Crossref live for published work matching the project's dominant
        topics (Roadmap 9.3). Returns [] when the library is empty or the lookup
        fails — never fabricates recommendations.
        """
        papers: list[Paper] = await asyncio.to_thread(
            lambda: db.query(Paper).filter(Paper.project_id == project_id).all()
        )
        if not papers:
            return []

        # Aggregate top topics across existing papers
        all_topics: dict[str, int] = defaultdict(int)
        for p in papers:
            combined = f"{p.title or ''} {p.abstract or ''}"
            keywords = extract_keywords_from_text(combined, max_keywords=5)
            for kw in keywords:
                all_topics[kw] += 1

        topic_labels = [
            k for k, _ in sorted(all_topics.items(), key=lambda x: x[1], reverse=True)[:3]
        ]
        if not topic_labels:
            return []

        query = " ".join(topic_labels)
        items: list[dict] = []
        try:
            client = get_async_http_client()
            url = (
                "https://api.crossref.org/works?query.bibliographic="
                + quote_plus(query)
                + "&rows=8&sort=relevance&select=DOI,title,author,issued,abstract,is-referenced-by-count"
            )
            resp = await client.get(url, timeout=10.0)
            if resp.status_code == 200:
                items = resp.json().get("message", {}).get("items", []) or []
            else:
                logger.warning("Crossref discovery returned status %s", resp.status_code)
        except Exception as exc:
            logger.warning("Crossref discovery lookup failed: %s", exc)

        existing_dois = {(p.doi or "").lower().strip() for p in papers if p.doi}
        existing_titles = {(p.title or "").lower().strip() for p in papers if p.title}

        recommendations: list[DiscoveryRecommendation] = []
        for item in items:
            doi = (item.get("DOI") or "").strip()
            titles = item.get("title") or []
            title = titles[0].strip() if titles and isinstance(titles[0], str) else None
            if not title:
                continue
            if doi.lower() in existing_dois or title.lower() in existing_titles:
                continue

            raw_authors = item.get("author") or []
            authors = [
                ", ".join(part for part in (a.get("family"), a.get("given")) if part).strip(", ")
                for a in raw_authors
            ]
            authors = [a for a in authors if a][:5]

            date_parts = (item.get("issued") or {}).get("date-parts") or [[None]]
            year = date_parts[0][0] if date_parts and date_parts[0] else None

            abstract = re.sub(r"<[^>]+>", " ", item.get("abstract") or "").strip() or None
            if abstract and len(abstract) > 400:
                abstract = abstract[:400].rsplit(" ", 1)[0] + "..."

            rec_id = (
                f"rec-{doi}"
                if doi
                else f"rec-{hashlib.blake2b(title.encode(), digest_size=4).hexdigest()}"
            )
            recommendations.append(
                DiscoveryRecommendation(
                    id=rec_id,
                    title=title,
                    authors=authors,
                    year=year,
                    abstract=abstract,
                    doi=doi or None,
                    arxiv_id=None,
                    relevance_score=None,
                    reason=f"Live Crossref result for library topics: {', '.join(topic_labels[:3])}.",
                    source_topics=topic_labels[:3],
                )
            )
            if len(recommendations) >= 5:
                break

        return recommendations
