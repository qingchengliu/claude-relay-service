from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Bundle, gen_uuid, now
from ..config import allowed_repo_url, repo_url_include_patterns
from ..prompt_metrics import ensure_prompt_metric, find_repo_urls
from .cas import resolve_member

router = APIRouter(prefix="/api", tags=["bundles"])


class BundleData(BaseModel):
    prompts: dict | None = None
    files: dict | None = None


class CreateBundleRequest(BaseModel):
    title: str = Field(min_length=1)
    data: BundleData


class CreateBundleResponse(BaseModel):
    success: bool
    id: str
    url: str


@router.post("/bundles", response_model=CreateBundleResponse)
async def create_bundle(
    req: CreateBundleRequest,
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
    distinct_id: str = Header(None, alias="X-Distinct-ID"),
):
    data = req.data.model_dump()
    repo_urls = find_repo_urls(data)
    if repo_url_include_patterns() and not any(allowed_repo_url(repo_url) for repo_url in repo_urls):
        return CreateBundleResponse(success=True, id="", url="")

    member_id = await resolve_member(db, api_key, distinct_id)
    created_at = now()
    bundle = Bundle(
        id=gen_uuid(), member_id=member_id, title=req.title,
        data=data, bundle_url=f"/bundles/{gen_uuid()}", created_at=created_at,
    )
    db.add(bundle)
    await ensure_prompt_metric(db, "bundle", bundle.id, member_id, repo_urls[0] if repo_urls else None, data, created_at)
    await db.commit()
    await db.refresh(bundle)
    return CreateBundleResponse(success=True, id=bundle.id, url=bundle.bundle_url or "")
