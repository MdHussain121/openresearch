import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import Citation, Document, Membership, Owner, Paper, Project
from app.services.auth import (
    create_user_with_personal_owner,
    verify_user_access_to_owner,
)

# In-memory test database
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_user_creation_with_polymorphic_owner_and_membership(db_session):
    # 1. Create a user
    user = create_user_with_personal_owner(
        db=db_session,
        email="researcher@university.edu",
        password="SecurePassword123",
        name="Dr. Alex Rivera",
    )

    assert user.id is not None
    assert user.email == "researcher@university.edu"
    assert user.personal_owner_id is not None

    # Check owner entity
    owner = db_session.query(Owner).filter(Owner.id == user.personal_owner_id).first()
    assert owner is not None
    assert owner.owner_type == "user"

    # Check membership granting access
    membership = (
        db_session.query(Membership)
        .filter(Membership.user_id == user.id, Membership.owner_id == owner.id)
        .first()
    )
    assert membership is not None
    assert membership.role == "owner"

    # Test v1 authorization helper
    has_access = verify_user_access_to_owner(db_session, user.id, owner.id)
    assert has_access is True

    # Test unauthorized access
    unauthorized = verify_user_access_to_owner(db_session, "non_existent_user", owner.id)
    assert unauthorized is False


def test_paper_extraction_status_and_citation_attribution_scope(db_session):
    user = create_user_with_personal_owner(
        db=db_session, email="student@mit.edu", password="SecurePassword123", name="Sam Taylor"
    )

    project = Project(owner_id=user.personal_owner_id, name="Deep Learning Survey")
    db_session.add(project)
    db_session.flush()

    # Paper with extraction_status ('ok' / 'unverified'; roadmap 1.3)
    paper_ok = Paper(
        project_id=project.id,
        title="Attention Is All You Need",
        authors=[{"familyName": "Vaswani", "givenName": "Ashish"}],
        year=2017,
        doi="10.48550/arXiv.1706.03762",
        extraction_status="ok",
    )
    paper_unverified = Paper(
        project_id=project.id,
        title="Scanned Legacy Report",
        year=1998,
        extraction_status="unverified",
    )
    db_session.add_all([paper_ok, paper_unverified])
    db_session.flush()

    assert paper_ok.extraction_status == "ok"
    assert paper_unverified.extraction_status == "unverified"

    # Document & Citation with attribution_scope ('sentence' / 'clause'; roadmap 1.3)
    doc = Document(project_id=project.id, title="Literature Synthesis")
    db_session.add(doc)
    db_session.flush()

    citation_clause = Citation(
        document_id=doc.id,
        paper_id=paper_ok.id,
        position=42,
        citation_style="apa",
        attribution_scope="clause",
        page_number=3,
        relevant_passage=(
            "The dominant sequence transduction models are based on complex recurrent or convolutional neural "
            "networks..."
        ),
    )
    db_session.add(citation_clause)
    db_session.commit()

    saved_citation = db_session.query(Citation).filter(Citation.id == citation_clause.id).first()
    assert saved_citation is not None
    assert saved_citation.attribution_scope == "clause"
    assert saved_citation.page_number == 3
    assert saved_citation.paper.title == "Attention Is All You Need"
