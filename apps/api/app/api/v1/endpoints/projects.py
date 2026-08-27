from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.membership import Membership
from app.models.owner import Owner
from app.models.project import Project
from app.models.user import User
from app.schemas.models import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    project_in: ProjectCreate,
    owner_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    target_owner_id = project_in.owner_id or owner_id or current_user.personal_owner_id

    # Verify user access to owner
    if not verify_user_access_to_owner(
        db, current_user.id, target_owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to create projects under this owner",
        )

    owner = db.query(Owner).filter(Owner.id == target_owner_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")

    project = Project(
        owner_id=target_owner_id, name=project_in.name, description=project_in.description
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(
    owner_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Project]:
    if owner_id:
        if not verify_user_access_to_owner(db, current_user.id, owner_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view projects for this owner",
            )
        return db.query(Project).filter(Project.owner_id == owner_id).all()

    # Otherwise return all projects accessible to current user across all memberships
    user_memberships = (
        db.query(Membership.owner_id).filter(Membership.user_id == current_user.id).all()
    )
    accessible_owner_ids = [m[0] for m in user_memberships]
    if current_user.personal_owner_id not in accessible_owner_ids:
        accessible_owner_ids.append(current_user.personal_owner_id)

    return (
        db.query(Project)
        .filter(Project.owner_id.in_(accessible_owner_ids))
        .order_by(Project.updated_at.desc())
        .all()
    )


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this project"
        )
    return project


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    project_in: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not verify_user_access_to_owner(
        db, current_user.id, project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update this project",
        )

    if project_in.name is not None:
        project.name = project_in.name
    if project_in.description is not None:
        project.description = project_in.description

    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not verify_user_access_to_owner(
        db, current_user.id, project.owner_id, required_roles=["owner"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only owner role can delete this project"
        )

    db.delete(project)
    db.commit()
    return
