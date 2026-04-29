from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Team, Member, gen_uuid

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def get_team(db: AsyncSession) -> Team:
    result = await db.execute(select(Team).limit(1))
    team = result.scalar_one_or_none()
    if not team:
        raise RuntimeError("No team configured")
    return team


class CreateMemberRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str | None = None
    distinct_id: str | None = None


@router.get("/team")
async def get_team_info(db: AsyncSession = Depends(get_db)):
    team = await get_team(db)
    return {"id": team.id, "name": team.name, "api_key": team.api_key,
            "created_at": team.created_at.isoformat() if team.created_at else None}


@router.get("/members")
async def list_members(db: AsyncSession = Depends(get_db)):
    team = await get_team(db)
    result = await db.execute(
        select(Member).where(Member.team_id == team.id).order_by(Member.created_at.desc()))
    return {"members": [
        {"id": m.id, "name": m.name, "email": m.email, "distinct_id": m.distinct_id,
         "created_at": m.created_at.isoformat() if m.created_at else None}
        for m in result.scalars().all()
    ]}


@router.post("/members")
async def create_member(req: CreateMemberRequest, db: AsyncSession = Depends(get_db)):
    team = await get_team(db)
    member = Member(id=gen_uuid(), team_id=team.id, name=req.name, email=req.email, distinct_id=req.distinct_id)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return {"id": member.id, "name": member.name, "email": member.email,
            "distinct_id": member.distinct_id, "created_at": member.created_at.isoformat() if member.created_at else None}
