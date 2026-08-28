"""Tests for auth access-control dependencies (require_project_access, require_document_access, role checks)."""

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import (
    require_document_access,
    require_project_access,
    require_project_access_with_roles,
)
from app.models.document import Document
from app.models.project import Project
from app.services.auth import create_user_with_personal_owner


def test_require_project_access_success_and_errors(db: Session):
    owner_user = create_user_with_personal_owner(
        db=db,
        email="owner_dep@example.com",
        password="Password123",
        name="Owner Dep",
    )
    other_user = create_user_with_personal_owner(
        db=db,
        email="other_dep@example.com",
        password="Password123",
        name="Other Dep",
    )

    proj = Project(
        name="Access Control Proj",
        owner_id=owner_user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    # 1. Success as owner
    result = require_project_access(project_id=proj.id, db=db, current_user=owner_user)
    assert result.id == proj.id

    # 2. Not found project
    with pytest.raises(HTTPException) as exc_404:
        require_project_access(project_id="non-existent-id", db=db, current_user=owner_user)
    assert exc_404.value.status_code == 404

    # 3. Forbidden for other user
    with pytest.raises(HTTPException) as exc_403:
        require_project_access(project_id=proj.id, db=db, current_user=other_user)
    assert exc_403.value.status_code == 403


def test_require_document_access_success_and_errors(db: Session):
    owner_user = create_user_with_personal_owner(
        db=db,
        email="owner_doc_dep@example.com",
        password="Password123",
        name="Owner Doc Dep",
    )
    other_user = create_user_with_personal_owner(
        db=db,
        email="other_doc_dep@example.com",
        password="Password123",
        name="Other Doc Dep",
    )

    proj = Project(
        name="Doc Access Proj",
        owner_id=owner_user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    doc = Document(
        project_id=proj.id,
        title="Access Doc",
        content_json={},
        plain_text="Text",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 1. Success as owner
    res_doc = require_document_access(document_id=doc.id, db=db, current_user=owner_user)
    assert res_doc.id == doc.id

    # 2. Document not found
    with pytest.raises(HTTPException) as exc_404:
        require_document_access(document_id="missing-doc-id", db=db, current_user=owner_user)
    assert exc_404.value.status_code == 404

    # 3. Forbidden for other user
    with pytest.raises(HTTPException) as exc_403:
        require_document_access(document_id=doc.id, db=db, current_user=other_user)
    assert exc_403.value.status_code == 403


def test_require_project_access_with_roles_factory(db: Session):
    owner_user = create_user_with_personal_owner(
        db=db,
        email="role_dep@example.com",
        password="Password123",
        name="Role Dep",
    )
    proj = Project(
        name="Role Proj",
        owner_id=owner_user.personal_owner_id,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    dep_owner = require_project_access_with_roles(["owner"])
    res = dep_owner(project_id=proj.id, db=db, current_user=owner_user)
    assert res.id == proj.id

    # Missing project in role dep
    with pytest.raises(HTTPException) as exc_404:
        dep_owner(project_id="missing-id", db=db, current_user=owner_user)
    assert exc_404.value.status_code == 404
