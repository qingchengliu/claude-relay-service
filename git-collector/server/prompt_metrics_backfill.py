from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from .models import Bundle, CasObject, PromptMetric
from .prompt_metrics import PROMPT_METRIC_VERSION, find_repo_urls, upsert_prompt_metric


async def _backfill_cas(db: AsyncSession, batch_size: int) -> int:
    total = 0
    while True:
        metric = aliased(PromptMetric)
        rows = (await db.execute(
            select(CasObject)
            .outerjoin(metric, and_(metric.source_type == "cas", metric.source_id == CasObject.id))
            .where(or_(metric.id.is_(None), metric.parser_version < PROMPT_METRIC_VERSION))
            .order_by(CasObject.created_at, CasObject.id)
            .limit(batch_size)
        )).scalars().all()
        if not rows:
            break
        for cas in rows:
            await upsert_prompt_metric(
                db, "cas", cas.id, cas.member_id, cas.repo_url,
                cas.content, cas.created_at,
            )
        await db.commit()
        total += len(rows)
    return total


async def _backfill_bundles(db: AsyncSession, batch_size: int) -> int:
    total = 0
    while True:
        metric = aliased(PromptMetric)
        rows = (await db.execute(
            select(Bundle)
            .outerjoin(metric, and_(metric.source_type == "bundle", metric.source_id == Bundle.id))
            .where(or_(metric.id.is_(None), metric.parser_version < PROMPT_METRIC_VERSION))
            .order_by(Bundle.created_at, Bundle.id)
            .limit(batch_size)
        )).scalars().all()
        if not rows:
            break
        for bundle in rows:
            repo_urls = find_repo_urls(bundle.data)
            await upsert_prompt_metric(
                db, "bundle", bundle.id, bundle.member_id,
                repo_urls[0] if repo_urls else None, bundle.data, bundle.created_at,
            )
        await db.commit()
        total += len(rows)
    return total


async def backfill_prompt_metrics(db: AsyncSession, batch_size: int = 200) -> dict:
    cas_count = await _backfill_cas(db, batch_size)
    bundle_count = await _backfill_bundles(db, batch_size)
    return {
        "parser_version": PROMPT_METRIC_VERSION,
        "cas": cas_count,
        "bundles": bundle_count,
        "total": cas_count + bundle_count,
    }
