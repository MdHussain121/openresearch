from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.membership import Membership
from app.models.owner import Owner
from app.models.user import User
from app.schemas.models import (
    TeamCreate,
    TeamMemberAdd,
    TeamMemberResponse,
    TeamMemberUpdate,
    TeamResponse,
    TeamUpdate,
)
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()


@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def create_team(
    team_in: TeamCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamResponse:
    """
    Creates a new Team Workspace (Roadmap 9.1).
    Initializes an Owner with owner_type='team' and assigns current user as 'owner'.
    """
    team_owner = Owner(
        name=team_in.name,
        description=team_in.description,
        owner_type="team",
        created_by_user_id=current_user.id,
    )
    db.add(team_owner)
    db.flush()

    # Add creator as owner in membership table
    membership = Membership(owner_id=team_owner.id, user_id=current_user.id, role="owner")
    db.add(membership)
    db.commit()
    db.refresh(team_owner)

    return TeamResponse(
        id=team_owner.id,
        name=team_owner.name or "Untitled Team",
        description=team_owner.description,
        owner_type="team",
        created_by_user_id=team_owner.created_by_user_id,
        member_count=1,
        current_user_role="owner",
        created_at=team_owner.created_at,
    )


@router.get("/teams", response_model=list[TeamResponse])
def list_teams(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[TeamResponse]:
    """
    Lists all team workspaces the current user has membership in.
    """
    memberships = db.query(Membership).filter(Membership.user_id == current_user.id).all()
    owner_ids = [m.owner_id for m in memberships]
    if not owner_ids:
        return []

    team_owners = db.query(Owner).filter(Owner.id.in_(owner_ids), Owner.owner_type == "team").all()

    # Aggregate counts in a single query to eliminate N+1 queries (§3.3)
    counts_query = (
        db.query(Membership.owner_id, func.count(Membership.id))
        .filter(Membership.owner_id.in_(owner_ids))
        .group_by(Membership.owner_id)
        .all()
    )
    count_map = {owner_id: count for owner_id, count in counts_query}
    mem_map = {m.owner_id: m.role for m in memberships}

    result: list[TeamResponse] = []
    for team in team_owners:
        result.append(
            TeamResponse(
                id=team.id,
                name=team.name or "Untitled Team",
                description=team.description,
                owner_type="team",
                created_by_user_id=team.created_by_user_id,
                member_count=count_map.get(team.id, 0),
                current_user_role=mem_map.get(team.id, "viewer"),
                created_at=team.created_at,
            )
        )
    return result


@router.get("/teams/{team_id}", response_model=TeamResponse)
def get_team(
    team_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> TeamResponse:
    team = db.query(Owner).filter(Owner.id == team_id, Owner.owner_type == "team").first()
    if not team:
        raise HTTPException(status_code=404, detail="Team workspace not found")

    membership = (
        db.query(Membership)
        .filter(Membership.owner_id == team_id, Membership.user_id == current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this team workspace")

    member_count = db.query(Membership).filter(Membership.owner_id == team.id).count()

    return TeamResponse(
        id=team.id,
        name=team.name or "Untitled Team",
        description=team.description,
        owner_type="team",
        created_by_user_id=team.created_by_user_id,
        member_count=member_count,
        current_user_role=membership.role,
        created_at=team.created_at,
    )


@router.patch("/teams/{team_id}", response_model=TeamResponse)
def update_team(
    team_id: str,
    team_in: TeamUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamResponse:
    team = db.query(Owner).filter(Owner.id == team_id, Owner.owner_type == "team").first()
    if not team:
        raise HTTPException(status_code=404, detail="Team workspace not found")

    if not verify_user_access_to_owner(
        db, current_user.id, team_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=403, detail="You must be an owner or editor to update team settings"
        )

    if team_in.name is not None:
        team.name = team_in.name
    if team_in.description is not None:
        team.description = team_in.description

    db.commit()
    db.refresh(team)

    membership = (
        db.query(Membership)
        .filter(Membership.owner_id == team_id, Membership.user_id == current_user.id)
        .first()
    )
    member_count = db.query(Membership).filter(Membership.owner_id == team.id).count()

    return TeamResponse(
        id=team.id,
        name=team.name or "Untitled Team",
        description=team.description,
        owner_type="team",
        created_by_user_id=team.created_by_user_id,
        member_count=member_count,
        current_user_role=membership.role if membership else "viewer",
        created_at=team.created_at,
    )


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    team = db.query(Owner).filter(Owner.id == team_id, Owner.owner_type == "team").first()
    if not team:
        raise HTTPException(status_code=404, detail="Team workspace not found")

    if not verify_user_access_to_owner(db, current_user.id, team_id, required_roles=["owner"]):
        raise HTTPException(status_code=403, detail="Only team owners can delete a team workspace")

    db.delete(team)
    db.commit()
    return


@router.get("/teams/{team_id}/members", response_model=list[TeamMemberResponse])
def list_team_members(
    team_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[TeamMemberResponse]:
    team = db.query(Owner).filter(Owner.id == team_id, Owner.owner_type == "team").first()
    if not team:
        raise HTTPException(status_code=404, detail="Team workspace not found")
    if not verify_user_access_to_owner(db, current_user.id, team_id):
        raise HTTPException(status_code=403, detail="You do not have access to this team workspace")

    memberships_with_users = (
        db.query(Membership, User)
        .outerjoin(User, Membership.user_id == User.id)
        .filter(Membership.owner_id == team_id)
        .all()
    )
    results: list[TeamMemberResponse] = []
    for m, user in memberships_with_users:
        results.append(
            TeamMemberResponse(
                id=m.id,
                owner_id=m.owner_id,
                user_id=m.user_id,
                email=user.email if user else None,
                name=user.name if user else None,
                role=m.role,
                created_at=m.created_at,
            )
        )
    return results


@router.post(
    "/teams/{team_id}/members",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_team_member(
    team_id: str,
    member_in: TeamMemberAdd,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamMemberResponse:
    if not verify_user_access_to_owner(db, current_user.id, team_id, required_roles=["owner"]):
        raise HTTPException(status_code=403, detail="Only team owners can invite/add new members")

    target_user = db.query(User).filter(User.email == member_in.email).first()
    if not target_user:
        raise HTTPException(status_code=404, detail=f"User with email {member_in.email} not found")

    existing = (
        db.query(Membership)
        .filter(Membership.owner_id == team_id, Membership.user_id == target_user.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="User is already a member of this team")

    membership = Membership(owner_id=team_id, user_id=target_user.id, role=member_in.role)
    db.add(membership)
    db.commit()
    db.refresh(membership)

    return TeamMemberResponse(
        id=membership.id,
        owner_id=membership.owner_id,
        user_id=membership.user_id,
        email=target_user.email,
        name=target_user.name,
        role=membership.role,
        created_at=membership.created_at,
    )


@router.patch("/teams/{team_id}/members/{membership_id}", response_model=TeamMemberResponse)
def update_team_member_role(
    team_id: str,
    membership_id: str,
    update_in: TeamMemberUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamMemberResponse:
    if not verify_user_access_to_owner(db, current_user.id, team_id, required_roles=["owner"]):
        raise HTTPException(status_code=403, detail="Only team owners can update member roles")

    membership = (
        db.query(Membership)
        .filter(Membership.id == membership_id, Membership.owner_id == team_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Membership record not found")

    if membership.role == "owner" and update_in.role != "owner":
        other_owners = (
            db.query(Membership)
            .filter(
                Membership.owner_id == team_id,
                Membership.role == "owner",
                Membership.id != membership.id,
            )
            .count()
        )
        if other_owners == 0:
            raise HTTPException(
                status_code=409, detail="Cannot demote the last owner. Promote another owner first."
            )

    membership.role = update_in.role
    db.commit()
    db.refresh(membership)

    user = db.query(User).filter(User.id == membership.user_id).first()
    return TeamMemberResponse(
        id=membership.id,
        owner_id=membership.owner_id,
        user_id=membership.user_id,
        email=user.email if user else None,
        name=user.name if user else None,
        role=membership.role,
        created_at=membership.created_at,
    )


@router.delete("/teams/{team_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_member(
    team_id: str,
    membership_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_user_access_to_owner(db, current_user.id, team_id, required_roles=["owner"]):
        raise HTTPException(status_code=403, detail="Only team owners can remove members")

    membership = (
        db.query(Membership)
        .filter(Membership.id == membership_id, Membership.owner_id == team_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")

    if membership.role == "owner":
        other_owners = (
            db.query(Membership)
            .filter(
                Membership.owner_id == team_id,
                Membership.role == "owner",
                Membership.id != membership.id,
            )
            .count()
        )
        if other_owners == 0:
            raise HTTPException(status_code=409, detail="Cannot remove the last owner of a team.")

    db.delete(membership)
    db.commit()
    return
