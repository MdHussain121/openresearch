"""Extended tests for RAGService, EmbeddingService, and chunking edge cases."""

from sqlalchemy.orm import Session

from app.models.paper import Paper
from app.models.project import Project
from app.services.auth import create_user_with_personal_owner
from app.services.rag_service import EmbeddingService, _safe_list_of_dicts, rag_service


def test_safe_list_of_dicts_helper():
    assert _safe_list_of_dicts(None) == []
    assert _safe_list_of_dicts("string") == []
    assert _safe_list_of_dicts(123) == []
    assert _safe_list_of_dicts([{"a": 1}, "string", 42, {"b": 2}]) == [{"a": 1}, {"b": 2}]


def test_embedding_service_edge_cases():
    # 1. Empty or whitespace text
    assert EmbeddingService.generate_embedding("") == [0.0] * 128
    assert EmbeddingService.generate_embedding("   ") == [0.0] * 128

    # 2. Text containing only stop words
    vec_stop = EmbeddingService.generate_embedding("the and or is in at of")
    assert len(vec_stop) == 128
    assert any(x > 0 for x in vec_stop)

    # 3. Normal academic text embedding
    vec = EmbeddingService.generate_embedding("Attention Mechanisms in Deep Neural Networks")
    assert len(vec) == 128
    assert round(sum(x * x for x in vec), 2) == 1.0

    # 4. Cosine similarity edge cases
    assert EmbeddingService.cosine_similarity([], []) == 0.0
    assert EmbeddingService.cosine_similarity([1.0], [1.0, 2.0]) == 0.0
    assert EmbeddingService.cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_rag_chunking_empty_and_populated_paper(db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="rag_chunk@example.com",
        password="Password123",
        name="RAG Chunk User",
    )
    proj = Project(name="Chunk Proj", owner_id=user.personal_owner_id)
    db.add(proj)
    db.commit()
    db.refresh(proj)

    # Empty paper
    empty_paper = Paper(
        id="p_empty",
        project_id=proj.id,
        title="Empty Paper",
        abstract="",
    )
    db.add(empty_paper)
    db.commit()
    empty_chunks = rag_service.chunk_paper(db=db, paper=empty_paper)
    assert len(empty_chunks) == 0

    # Populated paper with sections in metadata_json
    full_paper = Paper(
        id="p_full",
        project_id=proj.id,
        title="Transformer Architectures",
        abstract="We introduce the Transformer model based solely on attention mechanisms.",
        metadata_json={
            "sections": [
                {"title": "Introduction", "text": "Recurrent models generate sequences step-by-step."},
                {"title": "Conclusion", "text": "Transformers achieve state-of-the-art results in translation."},
            ]
        },
    )
    db.add(full_paper)
    db.commit()
    chunks = rag_service.chunk_paper(db=db, paper=full_paper)
    assert len(chunks) >= 2
    assert chunks[0].paper_id == "p_full"
    assert chunks[0].embedding is not None
    assert len(chunks[0].embedding) == 128


def test_rag_generate_chat_response_on_empty_project(db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="rag_empty@example.com",
        password="Password123",
        name="RAG User",
    )
    proj = Project(
        name="Empty RAG Proj",
        owner_id=user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    response = rag_service.generate_chat_response(
        db=db,
        project_id=proj.id,
        message="Summarize the key findings in this project",
        mode="project",
    )

    assert response.mode == "project"
    assert response.insufficient_evidence is True
    assert isinstance(response.answer, str)


def test_rag_generate_chat_response_general_mode(db: Session):
    user = create_user_with_personal_owner(
        db=db,
        email="rag_general@example.com",
        password="Password123",
        name="RAG General User",
    )
    proj = Project(
        name="General RAG Proj",
        owner_id=user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    response = rag_service.generate_chat_response(
        db=db,
        project_id=proj.id,
        message="What is reinforcement learning?",
        mode="general",
    )

    assert response.mode == "general"
    assert len(response.sources) == 0
    assert response.grounding_state == "general-knowledge"
