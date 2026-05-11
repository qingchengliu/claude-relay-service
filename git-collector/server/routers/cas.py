import re
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import CasObject, Member, Team, gen_uuid, now
from ..config import allowed_repo_url
from ..prompt_metrics import ensure_prompt_metric

router = APIRouter(prefix="/worker/cas", tags=["cas"])


class CasUploadItem(BaseModel):
    content: Any
    hash: str
    metadata: dict[str, str] | None = None


class CasUploadRequest(BaseModel):
    objects: list[CasUploadItem]


class CasResultItem(BaseModel):
    hash: str
    status: str
    error: str | None = None


class CasUploadResponse(BaseModel):
    results: list[CasResultItem]
    success_count: int
    failure_count: int


class CasReadResultItem(BaseModel):
    hash: str
    status: str
    content: Any | None = None
    error: str | None = None


class CasReadResponse(BaseModel):
    results: list[CasReadResultItem]
    success_count: int
    failure_count: int


def valid_hash(h: str) -> bool:
    return bool(re.match(r'^[0-9a-fA-F]+$', h))


async def resolve_member(db: AsyncSession, api_key: str | None, distinct_id: str | None) -> str | None:
    result = None
    if api_key:
        result = await db.execute(select(Team).where(Team.api_key == api_key))
    team = result.scalar_one_or_none() if result else None
    if not team:
        result = await db.execute(select(Team).limit(1))
        team = result.scalar_one_or_none()
    if not team:
        return None
    if distinct_id:
        result = await db.execute(
            select(Member).where(Member.team_id == team.id, Member.distinct_id == distinct_id)
        )
        member = result.scalar_one_or_none()
        if not member:
            member = Member(id=gen_uuid(), team_id=team.id, name=distinct_id[:8], distinct_id=distinct_id)
            db.add(member)
            await db.commit()
            await db.refresh(member)
        return member.id
    return None


@router.post("/upload", response_model=CasUploadResponse)
async def cas_upload(
    req: CasUploadRequest,
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
    distinct_id: str = Header(None, alias="X-Distinct-ID"),
):
    results = []
    success = 0
    failure = 0
    member_id = None

    for obj in req.objects:
        if not valid_hash(obj.hash):
            results.append(CasResultItem(hash=obj.hash, status="error", error="invalid hash"))
            failure += 1
            continue
        try:
            meta = obj.metadata or {}
            repo_url = meta.get("repo_url")
            if not allowed_repo_url(repo_url):
                results.append(CasResultItem(hash=obj.hash, status="ok"))
                success += 1
                continue
            if member_id is None:
                member_id = await resolve_member(db, api_key, distinct_id)
            cas = CasObject(
                id=gen_uuid(), hash=obj.hash, content=obj.content,
                kind=meta.get("kind", "unknown"), repo_url=repo_url,
                api_version=meta.get("api_version", "v1"), member_id=member_id,
                created_at=now(),
            )
            db.add(cas)
            await ensure_prompt_metric(db, "cas", cas.id, member_id, repo_url, obj.content, cas.created_at)
            await db.commit()
            results.append(CasResultItem(hash=obj.hash, status="ok"))
            success += 1
        except Exception:
            await db.rollback()
            existing = await db.execute(select(CasObject).where(CasObject.hash == obj.hash))
            existing_obj = existing.scalar_one_or_none()
            if existing_obj:
                await ensure_prompt_metric(
                    db, "cas", existing_obj.id, existing_obj.member_id,
                    existing_obj.repo_url, existing_obj.content, existing_obj.created_at,
                )
                await db.commit()
                results.append(CasResultItem(hash=obj.hash, status="ok"))
                success += 1
            else:
                results.append(CasResultItem(hash=obj.hash, status="error", error="storage error"))
                failure += 1

    return CasUploadResponse(results=results, success_count=success, failure_count=failure)


@router.get("/", response_model=CasReadResponse)
async def cas_read(hashes: str = Query(""), db: AsyncSession = Depends(get_db)):
    hash_list = [h.strip() for h in hashes.split(",") if h.strip()][:100]
    if not hash_list:
        return CasReadResponse(results=[], success_count=0, failure_count=0)

    results = []
    for h in hash_list:
        if not valid_hash(h):
            results.append(CasReadResultItem(hash=h, status="error", error="invalid hash"))
            continue
        obj = (await db.execute(select(CasObject).where(CasObject.hash == h))).scalar_one_or_none()
        results.append(CasReadResultItem(hash=h, status="ok", content=obj.content if obj else None))

    return CasReadResponse(results=results, success_count=len(results), failure_count=0)
