from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PromptMetric, gen_uuid

PROMPT_ROLES = {"user", "human"}
PROMPT_METRIC_VERSION = 1


def _messages(raw: Any) -> list[Any]:
    if isinstance(raw, dict) and isinstance(raw.get("messages"), list):
        return raw["messages"]
    return []


def _message_role(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    role = message.get("type") or message.get("role") or ""
    return str(role).lower()


def parse_prompt_metric(raw: Any) -> dict:
    messages = _messages(raw)
    role_counts: dict[str, int] = {}
    for message in messages:
        role = _message_role(message)
        if role:
            role_counts[role] = role_counts.get(role, 0) + 1
    return {
        "prompt_message_count": sum(role_counts.get(role, 0) for role in PROMPT_ROLES),
        "total_message_count": len(messages),
        "parser_version": PROMPT_METRIC_VERSION,
        "metric_data": {"role_counts": role_counts, "version": PROMPT_METRIC_VERSION},
    }


def find_repo_urls(value: Any) -> list[str]:
    urls = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key).lower()
            if isinstance(item, str) and (
                "repo_url" in key_text
                or key_text in {"repository", "repository_url", "remote_url", "git_url", "git_remote_url"}
            ):
                urls.append(item)
            urls.extend(find_repo_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(find_repo_urls(item))
    return urls


async def upsert_prompt_metric(
    db: AsyncSession,
    source_type: str,
    source_id: str,
    member_id: str | None,
    repo_url: str | None,
    raw: Any,
    created_at: datetime,
) -> None:
    parsed = parse_prompt_metric(raw)
    existing = await db.scalar(
        select(PromptMetric).where(
            PromptMetric.source_type == source_type,
            PromptMetric.source_id == source_id,
        )
    )
    if existing:
        existing.member_id = member_id
        existing.repo_url = repo_url
        existing.created_at = created_at
        existing.prompt_message_count = parsed["prompt_message_count"]
        existing.total_message_count = parsed["total_message_count"]
        existing.parser_version = parsed["parser_version"]
        existing.metric_data = parsed["metric_data"]
        return
    db.add(PromptMetric(
        id=gen_uuid(),
        source_type=source_type,
        source_id=source_id,
        member_id=member_id,
        repo_url=repo_url,
        created_at=created_at,
        **parsed,
    ))


async def ensure_prompt_metric(*args, **kwargs) -> None:
    await upsert_prompt_metric(*args, **kwargs)
