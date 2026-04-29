from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
from ..database import get_db
from ..models import MetricEvent, Member, Team, gen_uuid
from ..config import allowed_repo_url

router = APIRouter(prefix="/worker/metrics", tags=["metrics"])


class MetricsUploadRequest(BaseModel):
    v: int = 1
    events: list[dict] = Field(default_factory=list)


class MetricsErrorItem(BaseModel):
    index: int
    error: str


class MetricsUploadResponse(BaseModel):
    errors: list[MetricsErrorItem] = Field(default_factory=list)


EVENT_NAMES = {1: "Committed", 2: "AgentUsage", 3: "InstallHooks", 4: "Checkpoint"}

# 属性位号映射 (a)
ATTR_KEYS = {
    "0": "git_ai_version", "1": "repo_url", "2": "author", "3": "commit_sha",
    "4": "base_commit_sha", "5": "branch", "20": "tool", "21": "model",
    "22": "prompt_id", "23": "external_prompt_id", "30": "custom_attributes",
}

# 值位号映射 (v) - 按事件类型
VALUE_KEYS = {
    1: {  # Committed
        "0": "human_additions", "1": "git_diff_deleted_lines", "2": "git_diff_added_lines",
        "3": "tool_model_pairs", "4": "mixed_additions", "5": "ai_additions",
        "6": "ai_accepted", "7": "total_ai_additions", "8": "total_ai_deletions",
        "9": "time_waiting_for_ai", "10": "first_checkpoint_ts",
        "11": "commit_subject", "12": "commit_body",
    },
    3: {  # InstallHooks
        "0": "tool_id", "1": "status", "2": "message",
    },
    4: {  # Checkpoint
        "0": "checkpoint_ts", "1": "kind", "2": "file_path",
        "3": "lines_added", "4": "lines_deleted",
        "5": "lines_added_sloc", "6": "lines_deleted_sloc",
    },
}


def decode_pos(pos_map: dict) -> dict:
    return {ATTR_KEYS.get(k, f"attr_{k}"): v for k, v in pos_map.items()}


def decode_values(event_type: int, pos_map: dict) -> dict:
    keys = VALUE_KEYS.get(event_type, {})
    return {keys.get(k, f"val_{k}"): v for k, v in pos_map.items()}


def _custom_attributes(attrs: dict) -> dict:
    raw = attrs.get("custom_attributes")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def resolve_distinct_id(attrs: dict) -> str | None:
    custom = _custom_attributes(attrs)
    for key in ("user", "username", "member", "member_id"):
        value = custom.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    author = attrs.get("author")
    return author.strip() if isinstance(author, str) and author.strip() else None


async def resolve_member(db: AsyncSession, api_key: str | None, attrs: dict) -> str | None:
    result = None
    if api_key:
        result = await db.execute(select(Team).where(Team.api_key == api_key))
    team = result.scalar_one_or_none() if result else None
    if not team:
        # 回退到默认团队
        result = await db.execute(select(Team).limit(1))
        team = result.scalar_one_or_none()
    if not team:
        return None
    distinct_id = resolve_distinct_id(attrs)
    if not distinct_id:
        return None
    result = await db.execute(
        select(Member).where(Member.team_id == team.id, Member.distinct_id == distinct_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        member = Member(id=gen_uuid(), team_id=team.id, name=distinct_id[:32], distinct_id=distinct_id)
        db.add(member)
        await db.commit()
        await db.refresh(member)
    return member.id


@router.post("/upload", response_model=MetricsUploadResponse)
async def metrics_upload(
    req: MetricsUploadRequest,
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    errors = []
    for i, event in enumerate(req.events):
        try:
            event_type = event.get("e", 0)
            event_attrs = decode_pos(event.get("a", {}))
            repo_url = event_attrs.get("repo_url")
            if not allowed_repo_url(repo_url):
                continue
            event_values = decode_values(event_type, event.get("v", {}))
            event_extra = {k: v for k, v in event.items() if k not in {"e", "a", "v"}}
            merged = {**event_extra, **event_attrs, **event_values, "_event_type": event_type,
                       "_event_name": EVENT_NAMES.get(event_type, f"Unknown({event_type})"),
                       "_metrics_version": req.v, "_raw_event": event,
                       "_raw_attrs": event.get("a", {}), "_raw_values": event.get("v", {})}
            member_id = await resolve_member(db, api_key, event_attrs)
            db.add(MetricEvent(
                id=gen_uuid(), member_id=member_id, event_type=event_type,
                event_data=merged, repo_url=repo_url,
                commit_sha=event_attrs.get("commit_sha"),
            ))
        except Exception as e:
            errors.append(MetricsErrorItem(index=i, error=str(e)))
    await db.commit()
    return MetricsUploadResponse(errors=errors)
