from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .branch_utils import extract_requirement_id, normalize_branch_name
from .models import MetricEvent


async def backfill_metric_event_requirements(db: AsyncSession, batch_size: int = 500) -> dict:
    total = 0
    while True:
        rows = (await db.execute(
            select(MetricEvent)
            .where(MetricEvent.requirement_id.is_(None))
            .order_by(MetricEvent.created_at, MetricEvent.id)
            .limit(batch_size)
        )).scalars().all()
        if not rows:
            break

        for row in rows:
            branch = normalize_branch_name(row.branch_name)
            if not branch and isinstance(row.event_data, dict):
                branch = normalize_branch_name(row.event_data.get("branch"))
            req_id = extract_requirement_id(branch)
            row.branch_name = branch
            row.requirement_id = req_id if req_id is not None else -1
        await db.commit()
        total += len(rows)

    return {"updated": total}
