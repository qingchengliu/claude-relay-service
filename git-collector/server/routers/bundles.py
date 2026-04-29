from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Bundle, gen_uuid
from ..config import allowed_repo_url, repo_url_include_patterns
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


def _find_repo_urls(value) -> list[str]:
    urls = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key).lower()
            if isinstance(item, str) and (
                "repo_url" in key_text
                or key_text in {"repository", "repository_url", "remote_url", "git_url", "git_remote_url"}
            ):
                urls.append(item)
            urls.extend(_find_repo_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_find_repo_urls(item))
    return urls


@router.post("/bundles", response_model=CreateBundleResponse)
async def create_bundle(
    req: CreateBundleRequest,
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
    distinct_id: str = Header(None, alias="X-Distinct-ID"),
):
    data = req.data.model_dump()
    repo_urls = _find_repo_urls(data)
    if repo_url_include_patterns() and not any(allowed_repo_url(repo_url) for repo_url in repo_urls):
        return CreateBundleResponse(success=True, id="", url="")

    member_id = await resolve_member(db, api_key, distinct_id)
    bundle = Bundle(
        id=gen_uuid(), member_id=member_id, title=req.title,
        data=data, bundle_url=f"/bundles/{gen_uuid()}",
    )
    db.add(bundle)
    await db.commit()
    await db.refresh(bundle)
    return CreateBundleResponse(success=True, id=bundle.id, url=bundle.bundle_url or "")
