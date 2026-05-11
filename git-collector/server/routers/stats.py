from datetime import datetime, timezone, timedelta
from collections import Counter
from zoneinfo import ZoneInfo
from pathlib import PurePosixPath, PureWindowsPath
from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.sql import text
from ..database import get_db
from ..models import Team, Member, MetricEvent, CasObject, Bundle, PromptMetric
import asyncio

router = APIRouter(prefix="/api/stats", tags=["stats"])

# ============================================================
#  轻量 TTL 缓存 - 并行请求时避免重复重型查询
# ============================================================
_stats_cache: dict[str, tuple[float, object]] = {}
_cache_ttl: float = 5.0  # 5秒 TTL，足够覆盖一波 dashboard 并行刷新


def _cache_get(key: str) -> object | None:
    entry = _stats_cache.get(key)
    if entry:
        ts, val = entry
        if datetime.now(timezone.utc).timestamp() - ts < _cache_ttl:
            return val
        del _stats_cache[key]
    return None


def _cache_set(key: str, val: object):
    _stats_cache[key] = (datetime.now(timezone.utc).timestamp(), val)
    # 防止缓存膨胀
    if len(_stats_cache) > 50:
        oldest = min(_stats_cache, key=lambda k: _stats_cache[k][0])
        del _stats_cache[oldest]

# ============================================================
#  AI 贡献度评分: 代码量(50%) + 辅助频率(30%) + 活跃度(20%)
# ============================================================


async def get_team(db: AsyncSession, api_key: str | None) -> Team | None:
    if api_key:
        result = await db.execute(select(Team).where(Team.api_key == api_key))
        team = result.scalar_one_or_none()
        if team: return team
    result = await db.execute(select(Team).limit(1))
    return result.scalar_one_or_none()


async def get_member_ids(db: AsyncSession, team_id: str) -> list[str]:
    result = await db.execute(select(Member.id).where(Member.team_id == team_id))
    return [r[0] for r in result.all()]


AI_KINDS = {"ai_agent", "ai_tab"}
LOCAL_TZ = ZoneInfo("Asia/Shanghai")


def _since_for_days(days: int) -> datetime | None:
    if days <= 0:
        return None
    if days == 1:
        today = datetime.now(LOCAL_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        return today.astimezone(timezone.utc)
    return datetime.now(timezone.utc) - timedelta(days=days)


def _start_for_days(days: int, default_days: int = 30) -> datetime:
    return _since_for_days(days) or (datetime.now(timezone.utc) - timedelta(days=default_days))


def _sum_num(value) -> int:
    if isinstance(value, list):
        return sum(_sum_num(v) for v in value)
    if isinstance(value, (int, float)):
        return int(value)
    return 0


def _metric_total(value) -> int:
    # git-ai 上报数组约定: 第 0 位是 all 汇总，后续是各 tool/model 明细。
    if isinstance(value, list):
        return _sum_num(value[0]) if value else 0
    return _sum_num(value)


def _metric_at(value, index: int) -> int:
    if isinstance(value, list):
        return _sum_num(value[index]) if index < len(value) else 0
    return _sum_num(value) if index == 0 else 0


def _split_tool_model(pair: str | None) -> tuple[str, str]:
    raw = str(pair or "unknown")
    if "::" in raw:
        tool, model = raw.split("::", 1)
        return tool or "unknown", model or "unknown"
    return raw or "unknown", "unknown"


def _deleted_file_lines(value) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, list):
        return sum(_deleted_file_lines(v) for v in value)
    if not isinstance(value, dict):
        return 0

    status = str(value.get("status") or value.get("change_type") or "").lower()
    is_deleted = value.get("deleted") is True or status in {"deleted", "delete", "removed", "d"}
    if is_deleted:
        for key in ("deleted_lines", "lines_deleted", "old_lines", "lines"):
            lines = _sum_num(value.get(key))
            if lines > 0:
                return lines
    return sum(_deleted_file_lines(v) for v in value.values())


def _commit_metrics(evt_data: dict) -> dict:
    if not isinstance(evt_data, dict):
        return {
            "ai_added": 0, "ai_deleted": 0, "ai_activity_added": 0,
            "ai_activity_deleted": 0, "ai_activity": 0, "human_added": 0,
            "mixed_added": 0, "ai_accepted": 0,
            "total_added": 0, "total_deleted": 0, "total_edit": 0,
            "ai_edit": 0, "non_ai_added": 0,
        }
    ai_added = _metric_total(evt_data.get("ai_additions"))
    mixed_added = _metric_total(evt_data.get("mixed_additions"))
    ai_accepted = _metric_total(evt_data.get("ai_accepted"))
    activity_ai_added = _metric_total(evt_data.get("total_ai_additions")) or ai_added
    activity_ai_deleted = _metric_total(evt_data.get("total_ai_deletions"))
    human_added = _metric_total(evt_data.get("human_additions"))
    raw_added = _metric_total(evt_data.get("git_diff_added_lines"))
    total_added = raw_added if raw_added > 0 or "git_diff_added_lines" in evt_data else ai_added + human_added
    raw_deleted = _metric_total(evt_data.get("git_diff_deleted_lines"))
    deleted_file_lines = _deleted_file_lines(
        evt_data.get("git_diff_deleted_file_lines")
        or evt_data.get("deleted_file_lines")
        or evt_data.get("deleted_files_lines")
        or evt_data.get("file_deleted_lines")
        or evt_data.get("removed_file_lines")
        or evt_data.get("deleted_files")
        or evt_data.get("files")
    )
    total_deleted = raw_deleted - min(raw_deleted, deleted_file_lines)
    return {
        "ai_added": ai_added,
        "ai_deleted": activity_ai_deleted,
        "ai_activity_added": activity_ai_added,
        "ai_activity_deleted": activity_ai_deleted,
        "ai_activity": activity_ai_added + activity_ai_deleted,
        "human_added": human_added,
        "mixed_added": mixed_added,
        "ai_accepted": ai_accepted,
        "total_added": total_added,
        "total_deleted": total_deleted,
        "total_edit": total_added + total_deleted,
        "ai_edit": ai_added,
        "non_ai_added": max(0, total_added - ai_added),
    }


def _aggregate_commits(committed: list[tuple]) -> dict:
    totals = {
        "ai_added": 0, "ai_deleted": 0, "ai_activity_added": 0,
        "ai_activity_deleted": 0, "ai_activity": 0, "human_added": 0,
        "mixed_added": 0, "ai_accepted": 0,
        "total_added": 0, "total_deleted": 0, "total_edit": 0,
        "ai_edit": 0, "non_ai_added": 0,
    }
    for (evt_data,) in committed:
        cm = _commit_metrics(evt_data)
        for key in totals:
            totals[key] += cm[key]
    totals["ai_code_pct"] = min(100, round(totals["ai_added"] / totals["total_added"] * 100, 1)) if totals["total_added"] > 0 else 0
    totals["ai_added_pct"] = round(totals["ai_added"] / totals["total_added"] * 100, 1) if totals["total_added"] > 0 else 0
    return totals


def _tool_model_usage_from_commits(committed: list[tuple]) -> tuple[list[dict], list[dict]]:
    agents: Counter[str] = Counter()
    models: Counter[str] = Counter()
    for (evt_data,) in committed:
        if not isinstance(evt_data, dict):
            continue
        pairs = evt_data.get("tool_model_pairs")
        if not isinstance(pairs, list) or len(pairs) <= 1:
            continue
        for pair in pairs[1:]:
            agent, model = _split_tool_model(pair)
            agents[agent] += 1
            models[model] += 1
    agent_rows = [{"name": name, "count": count} for name, count in agents.most_common(8)]
    model_rows = [{"name": name, "count": count} for name, count in models.most_common(8)]
    return agent_rows, model_rows


def _parse_committed(committed: list[tuple]) -> tuple[int, int, int]:
    totals = _aggregate_commits(committed)
    return totals["ai_added"], totals["ai_deleted"], totals["human_added"]


def _file_ext(path: str | None) -> str:
    if not path:
        return "[none]"
    normalized = str(path).replace("\\", "/")
    suffix = PurePosixPath(normalized).suffix or PureWindowsPath(path).suffix
    return suffix.lower() if suffix else "[none]"


def calc_score(ai_lines: int, total_lines: int, commits: int, total_commits: int,
                checkpoints: int, active_days: int) -> dict:
    vol = (ai_lines / total_lines * 100) if total_lines > 0 else 0
    freq = (commits / total_commits * 100) if total_commits > 0 else 0
    act = min(checkpoints / max(1, active_days) / 20, 1) * 100
    score = vol * 0.50 + freq * 0.30 + act * 0.20
    lv = "S" if score >= 80 else "A" if score >= 60 else "B" if score >= 40 else "C" if score >= 20 else "D"
    return {"score": round(score, 1), "level": lv,
            "sub_scores": {"volume": round(vol, 1), "frequency": round(freq, 1),
                           "activity": round(act, 1)}}


# ============================================================
#  高性能 prompt 消息计数 - 读取上报时预解析的派生表
#  原始 CAS/Bundle 仍保留，后续新增指标可重新回溯解析
# ============================================================

async def _prompt_count_for_members(db: AsyncSession, member_ids: list[str], since: datetime | None = None) -> int:
    """读取上报时预解析的 prompt 指标，避免看板查询反复扫描原始 JSON。"""
    if not member_ids:
        return 0
    cache_key = f"pcm:{','.join(sorted(member_ids))}:{since.isoformat() if since else 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    conds = [PromptMetric.member_id.in_(member_ids)]
    if since:
        conds.append(PromptMetric.created_at >= since)
    total = await db.scalar(select(func.sum(PromptMetric.prompt_message_count)).where(*conds)) or 0
    _cache_set(cache_key, total)
    return total


async def _prompt_count_for_member(db: AsyncSession, member_id: str, since: datetime | None = None) -> int:
    return await _prompt_count_for_members(db, [member_id], since)


async def _prompt_count_by_member(db: AsyncSession, member_ids: list[str], since: datetime | None = None) -> dict[str, int]:
    """按成员分组统计 prompt 消息数，一次查询返回 {member_id: count}。"""
    if not member_ids:
        return {}
    cache_key = f"pcbm:{','.join(sorted(member_ids))}:{since.isoformat() if since else 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    conds = [PromptMetric.member_id.in_(member_ids)]
    if since:
        conds.append(PromptMetric.created_at >= since)
    rows = await db.execute(
        select(PromptMetric.member_id, func.sum(PromptMetric.prompt_message_count))
        .where(*conds).group_by(PromptMetric.member_id)
    )
    result = {mid: cnt or 0 for mid, cnt in rows.all()}
    _cache_set(cache_key, result)
    return result


async def _prompt_count_by_repo(db: AsyncSession, repo_urls: list[str], since: datetime | None = None) -> dict[str, int]:
    """按仓库分组统计 prompt 消息数。"""
    if not repo_urls:
        return {}
    cache_key = f"pcbr:{','.join(sorted(repo_urls))}:{since.isoformat() if since else 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    conds = [PromptMetric.repo_url.in_(repo_urls)]
    if since:
        conds.append(PromptMetric.created_at >= since)
    rows = await db.execute(
        select(PromptMetric.repo_url, func.sum(PromptMetric.prompt_message_count))
        .where(*conds).group_by(PromptMetric.repo_url)
    )
    result = {repo_url: cnt or 0 for repo_url, cnt in rows.all()}
    _cache_set(cache_key, result)
    return result


# ============================================================
#  批量加载成员详情 - 消除 N+1 查询
# ============================================================

async def _batch_member_details(db: AsyncSession, members: list[Member], since: datetime | None = None) -> dict[str, dict]:
    """一次批量查询加载所有成员的详情数据，替代逐成员调用 _build_user_detail。"""
    if not members:
        return {}
    cache_key = f"bmd:{','.join(sorted(m.id for m in members))}:{since.isoformat() if since else 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    member_ids = [m.id for m in members]
    now_ts = datetime.now(timezone.utc)
    week_ago = now_ts - timedelta(days=7)

    # 1. 团队总提交数 (所有成员)
    team_commit_conds = [MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 1]
    if since: team_commit_conds.append(MetricEvent.created_at >= since)
    team_commit_count = await db.scalar(select(func.count(MetricEvent.id)).where(*team_commit_conds)) or 0

    # 2. 批量加载所有成员的 commit event_data
    commit_conds = [MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 1]
    if since: commit_conds.append(MetricEvent.created_at >= since)
    result = await db.execute(select(MetricEvent.member_id, MetricEvent.event_data).where(*commit_conds))
    commits_by_member: dict[str, list[tuple]] = {}
    for mid, evt_data in result.all():
        commits_by_member.setdefault(mid, []).append((evt_data,))

    # 3. 批量 checkpoint 计数
    cc = [MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 4]
    if since: cc.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.member_id, func.count(MetricEvent.id)).where(*cc).group_by(MetricEvent.member_id))
    checkpoint_counts = {r[0]: r[1] for r in result.all()}

    # 4. 批量 AI edit 计数
    ai_cc = [
        MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 4,
        MetricEvent.event_data["kind"].as_string().in_(list(AI_KINDS)),
    ]
    if since: ai_cc.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.member_id, func.count(MetricEvent.id)).where(*ai_cc).group_by(MetricEvent.member_id))
    edit_counts = {r[0]: r[1] for r in result.all()}

    # 5. 批量 agent usage 计数
    ac = [MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 2]
    if since: ac.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.member_id, func.count(MetricEvent.id)).where(*ac).group_by(MetricEvent.member_id))
    agent_usage_counts = {r[0]: r[1] for r in result.all()}

    # 6. 批量活跃天数
    adc = [MetricEvent.member_id.in_(member_ids)]
    if since: adc.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.member_id, func.count(func.distinct(func.date(MetricEvent.created_at))))
        .where(*adc).group_by(MetricEvent.member_id))
    active_days_map = {r[0]: r[1] for r in result.all()}

    # 7. 批量仓库数
    rc = [MetricEvent.member_id.in_(member_ids), MetricEvent.repo_url.isnot(None)]
    if since: rc.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.member_id, func.count(func.distinct(MetricEvent.repo_url)))
        .where(*rc).group_by(MetricEvent.member_id))
    repo_counts = {r[0]: r[1] for r in result.all()}

    # 8. 批量最近活跃时间
    result = await db.execute(
        select(MetricEvent.member_id, func.max(MetricEvent.created_at))
        .where(MetricEvent.member_id.in_(member_ids)).group_by(MetricEvent.member_id))
    last_active_map = {r[0]: r[1] for r in result.all()}

    # 9. 批量 7日活跃
    result = await db.execute(
        select(MetricEvent.member_id, func.count(MetricEvent.id))
        .where(MetricEvent.member_id.in_(member_ids), MetricEvent.created_at >= week_ago)
        .group_by(MetricEvent.member_id))
    active_7d_map = {r[0]: r[1] for r in result.all()}

    # 10. 批量 prompt 消息计数 (DB 内 SQL 统计)
    prompt_counts = await _prompt_count_by_member(db, member_ids, since)

    # 组装结果
    details = {}
    for m in members:
        mid = m.id
        committed = commits_by_member.get(mid, [])
        commit_totals = _aggregate_commits(committed)
        agents, models = _tool_model_usage_from_commits(committed)
        contribution = calc_score(
            commit_totals["ai_added"], commit_totals["total_added"],
            len(committed), team_commit_count,
            edit_counts.get(mid, 0), max(1, active_days_map.get(mid, 0)),
        )

        last_active = last_active_map.get(mid)
        details[mid] = {
            "id": m.id, "name": m.name, "email": m.email, "distinct_id": m.distinct_id,
            "commit_count": len(committed), "edit_count": edit_counts.get(mid, 0),
            "checkpoint_count": checkpoint_counts.get(mid, 0),
            "agent_usage_count": agent_usage_counts.get(mid, 0),
            "repo_count": repo_counts.get(mid, 0),
            "active_days": active_days_map.get(mid, 0),
            "active_7d": active_7d_map.get(mid, 0) > 0,
            "ai_lines": commit_totals["ai_added"], "human_lines": commit_totals["human_added"],
            "ai_deleted": commit_totals["ai_deleted"], "ai_pct": commit_totals["ai_code_pct"],
            "mixed_added_lines": commit_totals["mixed_added"],
            "ai_accepted_lines": commit_totals["ai_accepted"],
            "total_added_lines": commit_totals["total_added"],
            "total_deleted_lines": commit_totals["total_deleted"],
            "total_edit_lines": commit_totals["total_edit"],
            "ai_edit_lines": commit_totals["ai_edit"],
            "ai_activity_lines": commit_totals["ai_activity"],
            "ai_code_pct": commit_totals["ai_code_pct"],
            "prompt_message_count": prompt_counts.get(mid, 0),
            "last_active": last_active.isoformat() if last_active else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "agents": agents, "models": models, "contribution": contribution,
        }

    result = details
    _cache_set(cache_key, result)
    return result


# ============================================================
#  /overview
# ============================================================
@router.get("/overview")
async def overview(
    days: int = Query(default=0, description="0=全部, 1=当日, 7/30=近N天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team:
        return {"member_count": 0, "total_commits": 0, "total_events": 0,
                "ai_acceptance_rate": 0, "total_ai_lines": 0,
                "total_human_lines": 0, "total_ai_deleted": 0, "active_users_7d": 0,
                "active_users_30d": 0, "team_ai_score": 0, "trend": "stable",
                "total_edit_count": 0, "total_cas": 0, "total_bundles": 0,
                "avg_ai_lines_per_commit": 0,
                "total_added_lines": 0, "total_deleted_lines": 0,
                "total_edit_lines": 0, "ai_edit_lines": 0, "ai_code_pct": 0,
                "agent_edit_count": 0, "prompt_message_count": 0}

    member_ids = await get_member_ids(db, team.id)
    since = _since_for_days(days)
    event_conds = [MetricEvent.member_id.in_(member_ids)]
    commit_conds = [*event_conds, MetricEvent.event_type == 1]
    edit_conds = [*event_conds, MetricEvent.event_type == 4]
    cas_conds = [CasObject.member_id.in_(member_ids)]
    bundle_conds = [Bundle.member_id.in_(member_ids)]
    if since:
        event_conds.append(MetricEvent.created_at >= since)
        commit_conds.append(MetricEvent.created_at >= since)
        edit_conds.append(MetricEvent.created_at >= since)
        cas_conds.append(CasObject.created_at >= since)
        bundle_conds.append(Bundle.created_at >= since)

    total_cas = await db.scalar(select(func.count(CasObject.id)).where(*cas_conds)) or 0
    total_bundles = await db.scalar(select(func.count(Bundle.id)).where(*bundle_conds)) or 0

    empty_result = {
        "member_count": 0, "total_commits": 0, "total_events": 0,
        "ai_acceptance_rate": 0, "total_ai_lines": 0,
        "total_human_lines": 0, "total_ai_deleted": 0, "active_users_7d": 0,
        "active_users_30d": 0, "team_ai_score": 0, "trend": "stable",
        "total_edit_count": 0, "total_cas": total_cas, "total_bundles": total_bundles,
        "avg_ai_lines_per_commit": 0,
        "total_added_lines": 0, "total_deleted_lines": 0,
        "total_edit_lines": 0, "ai_edit_lines": 0, "ai_code_pct": 0,
        "agent_edit_count": 0, "prompt_message_count": 0,
    }
    if not member_ids:
        return empty_result

    total_events = await db.scalar(select(func.count(MetricEvent.id)).where(*event_conds)) or 0

    # Committed events - 聚合所有提交数据
    result = await db.execute(select(MetricEvent.event_data).where(*commit_conds))
    committed = [(evt_data,) for (evt_data,) in result.all()]
    commit_totals = _aggregate_commits(committed)
    ai_lines = commit_totals["ai_added"]
    ai_del = commit_totals["ai_deleted"]
    human = commit_totals["human_added"]
    total_commits = len(committed)

    total_edit_count = await db.scalar(select(func.count(MetricEvent.id)).where(*edit_conds)) or 0
    ai_edit_count = await db.scalar(
        select(func.count(MetricEvent.id)).where(
            *edit_conds,
            MetricEvent.event_data["kind"].as_string().in_(list(AI_KINDS)),
        )) or 0

    # prompt 消息计数 - 使用 SQL json_each 在 DB 内统计
    prompt_message_count = await _prompt_count_for_members(db, member_ids, since)

    # 活跃用户统计
    now_ts = datetime.now(timezone.utc)
    week_ago = now_ts - timedelta(days=7)
    month_ago = now_ts - timedelta(days=30)
    active_base = [MetricEvent.member_id.in_(member_ids)]
    if since:
        active_base.append(MetricEvent.created_at >= since)
    active_in_range = (await db.execute(
        select(func.count(func.distinct(MetricEvent.member_id))).where(*active_base))).scalar() or 0
    active_7d = active_in_range if since else (await db.execute(
        select(func.count(func.distinct(MetricEvent.member_id))).where(
            MetricEvent.member_id.in_(member_ids), MetricEvent.created_at >= week_ago))).scalar() or 0
    active_30d = active_in_range if since else (await db.execute(
        select(func.count(func.distinct(MetricEvent.member_id))).where(
            MetricEvent.member_id.in_(member_ids), MetricEvent.created_at >= month_ago))).scalar() or 0

    total_all = ai_lines + human
    acc_rate = round(ai_lines / total_all * 100, 1) if total_all > 0 else 0
    team_score = acc_rate * 0.60 + min(active_7d / max(1, len(member_ids)) * 100, 100) * 0.40

    # 趋势判断
    p1_start = week_ago - timedelta(days=7)
    p1 = (await db.execute(
        select(func.count(MetricEvent.id)).where(
            MetricEvent.member_id.in_(member_ids), MetricEvent.created_at >= p1_start, MetricEvent.created_at < week_ago))).scalar() or 0
    p2 = (await db.execute(
        select(func.count(MetricEvent.id)).where(
            MetricEvent.member_id.in_(member_ids), MetricEvent.created_at >= week_ago))).scalar() or 0
    if p1 > 0:
        chg = (p2 - p1) / p1
        trend = "up" if chg > 0.15 else "down" if chg < -0.15 else "stable"
    else:
        trend = "up" if p2 > 0 else "stable"

    return {
        "member_count": len(member_ids), "total_commits": total_commits,
        "total_events": total_events, "total_edit_count": total_edit_count,
        "total_cas": total_cas, "total_bundles": total_bundles,
        "active_users_7d": active_7d, "active_users_30d": active_30d,
        "ai_acceptance_rate": acc_rate,
        "total_ai_lines": ai_lines, "total_human_lines": human,
        "total_ai_deleted": ai_del,
        "mixed_added_lines": commit_totals["mixed_added"],
        "ai_accepted_lines": commit_totals["ai_accepted"],
        "ai_activity_lines": commit_totals["ai_activity"],
        "ai_activity_added": commit_totals["ai_activity_added"],
        "ai_activity_deleted": commit_totals["ai_activity_deleted"],
        "total_added_lines": commit_totals["total_added"],
        "total_deleted_lines": commit_totals["total_deleted"],
        "total_edit_lines": commit_totals["total_edit"],
        "ai_edit_lines": commit_totals["ai_edit"],
        "ai_code_pct": commit_totals["ai_code_pct"],
        "agent_edit_count": ai_edit_count,
        "prompt_message_count": prompt_message_count,
        "team_ai_score": round(team_score, 1), "trend": trend,
        "avg_ai_lines_per_commit": round(ai_lines / total_commits) if total_commits > 0 else 0,
    }


# ============================================================
#  /users
# ============================================================
@router.get("/users")
async def users(
    days: int = Query(default=0, description="0=全部, 1=当日, 7/30=近N天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"users": [], "total": 0}

    since = _since_for_days(days)

    result = await db.execute(
        select(Member).where(Member.team_id == team.id).order_by(Member.created_at.desc()).limit(100))
    members = result.scalars().all()

    # 批量加载所有成员详情
    details = await _batch_member_details(db, list(members), since)

    users_list = [details[m.id] for m in members if m.id in details]
    return {"users": users_list, "total": len(users_list)}


# ============================================================
#  /user-detail/{member_id}
# ============================================================
@router.get("/user-detail/{member_id}")
async def user_detail(
    member_id: str,
    days: int = Query(default=0),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    result = await db.execute(select(Member).where(Member.id == member_id))
    member = result.scalar_one_or_none()
    if not member: return {"error": "User not found"}

    since = _since_for_days(days)
    detail = await _build_user_detail(db, member, since)
    detail["daily"] = await _build_user_daily(db, member.id)
    detail["model_breakdown"] = await _build_user_models(db, member.id, since)
    detail["agent_model_breakdown"] = await _build_user_agent_models(db, member.id, since)
    return detail


async def _build_user_detail(db: AsyncSession, m: Member, since: datetime | None = None) -> dict:
    now_ts = datetime.now(timezone.utc)
    week_ago = now_ts - timedelta(days=7)

    conds = [MetricEvent.member_id == m.id, MetricEvent.event_type == 1]
    if since: conds.append(MetricEvent.created_at >= since)
    result = await db.execute(select(MetricEvent.event_data).where(*conds))
    committed = [(evt_data,) for (evt_data,) in result.all()]
    commit_totals = _aggregate_commits(committed)
    ai_lines = commit_totals["ai_added"]
    ai_del = commit_totals["ai_deleted"]
    human = commit_totals["human_added"]
    commit_count = len(committed)

    team_commit_conds = [
        MetricEvent.member_id.in_(select(Member.id).where(Member.team_id == m.team_id)),
        MetricEvent.event_type == 1,
    ]
    if since: team_commit_conds.append(MetricEvent.created_at >= since)
    team_commit_count = await db.scalar(select(func.count(MetricEvent.id)).where(*team_commit_conds)) or 0

    cc = [MetricEvent.member_id == m.id, MetricEvent.event_type == 4]
    if since: cc.append(MetricEvent.created_at >= since)
    checkpoint_count = await db.scalar(select(func.count(MetricEvent.id)).where(*cc)) or 0
    ai_cc = [*cc, MetricEvent.event_data["kind"].as_string().in_(list(AI_KINDS))]
    edit_count = await db.scalar(select(func.count(MetricEvent.id)).where(*ai_cc)) or 0

    ac = [MetricEvent.member_id == m.id, MetricEvent.event_type == 2]
    if since: ac.append(MetricEvent.created_at >= since)
    agent_usage_count = await db.scalar(select(func.count(MetricEvent.id)).where(*ac)) or 0

    adc = [MetricEvent.member_id == m.id]
    if since: adc.append(MetricEvent.created_at >= since)
    active_days = (await db.execute(
        select(func.count(func.distinct(func.date(MetricEvent.created_at)))).where(*adc))).scalar() or 0

    last_evt = await db.execute(
        select(MetricEvent.created_at).where(MetricEvent.member_id == m.id)
        .order_by(MetricEvent.created_at.desc()).limit(1))
    last_active = last_evt.scalar_one_or_none()

    rc = [MetricEvent.member_id == m.id, MetricEvent.repo_url.isnot(None)]
    if since: rc.append(MetricEvent.created_at >= since)
    repo_count = await db.scalar(
        select(func.count(func.distinct(MetricEvent.repo_url))).where(*rc)) or 0

    active_7d_result = await db.scalar(
        select(func.count(MetricEvent.id)).where(
            MetricEvent.member_id == m.id, MetricEvent.created_at >= week_ago)) or 0

    agents, models = _tool_model_usage_from_commits(committed)

    total_lines = commit_totals["total_added"]
    ai_pct = commit_totals["ai_code_pct"]
    prompt_message_count = await _prompt_count_for_member(db, m.id, since)
    contribution = calc_score(ai_lines, total_lines, commit_count, team_commit_count,
                              edit_count, max(1, active_days))

    return {
        "id": m.id, "name": m.name, "email": m.email, "distinct_id": m.distinct_id,
        "commit_count": commit_count, "edit_count": edit_count,
        "checkpoint_count": checkpoint_count,
        "agent_usage_count": agent_usage_count, "repo_count": repo_count,
        "active_days": active_days, "active_7d": active_7d_result > 0,
        "ai_lines": ai_lines, "human_lines": human, "ai_deleted": ai_del, "ai_pct": ai_pct,
        "mixed_added_lines": commit_totals["mixed_added"],
        "ai_accepted_lines": commit_totals["ai_accepted"],
        "total_added_lines": commit_totals["total_added"],
        "total_deleted_lines": commit_totals["total_deleted"],
        "total_edit_lines": commit_totals["total_edit"],
        "ai_edit_lines": commit_totals["ai_edit"],
        "ai_activity_lines": commit_totals["ai_activity"],
        "ai_code_pct": commit_totals["ai_code_pct"],
        "prompt_message_count": prompt_message_count,
        "last_active": last_active.isoformat() if last_active else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "agents": agents, "models": models, "contribution": contribution,
    }


async def _build_user_daily(db: AsyncSession, member_id: str) -> list[dict]:
    start_date = datetime.now(timezone.utc) - timedelta(days=30)
    query = text("""
        SELECT DATE(created_at) as day,
               COUNT(*) as events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
        FROM metric_events WHERE member_id = :mid AND created_at >= :sd
        GROUP BY DATE(created_at) ORDER BY day ASC
    """)
    result = await db.execute(query, {"mid": member_id, "sd": start_date.isoformat()})
    return [{"date": r[0], "events": r[1], "commits": r[2], "edits": r[3]} for r in result.all()]


async def _build_user_models(db: AsyncSession, member_id: str, since: datetime | None = None) -> list[dict]:
    conds = [MetricEvent.member_id == member_id, MetricEvent.event_type == 1]
    if since: conds.append(MetricEvent.created_at >= since)
    result = await db.execute(select(MetricEvent.event_data).where(*conds))
    models: dict[str, dict] = {}
    for (evt_data,) in result.all():
        if not isinstance(evt_data, dict):
            continue
        pairs = evt_data.get("tool_model_pairs")
        if not isinstance(pairs, list) or len(pairs) <= 1:
            continue
        for i, pair in enumerate(pairs[1:], start=1):
            _, model = _split_tool_model(pair)
            row = models.setdefault(model, {"model": model, "count": 0, "ai_code_lines": 0})
            row["count"] += 1
            row["ai_code_lines"] += _metric_at(evt_data.get("ai_additions"), i)
    return sorted(models.values(), key=lambda x: (x["ai_code_lines"], x["count"]), reverse=True)[:10]


async def _build_user_agent_models(db: AsyncSession, member_id: str, since: datetime | None = None) -> list[dict]:
    conds = [MetricEvent.member_id == member_id, MetricEvent.event_type == 1]
    if since: conds.append(MetricEvent.created_at >= since)
    result = await db.execute(select(MetricEvent.event_data).where(*conds))

    rows: dict[tuple[str, str], dict] = {}
    for (evt_data,) in result.all():
        if not isinstance(evt_data, dict):
            continue
        total_added = _commit_metrics(evt_data)["total_added"]
        pairs = evt_data.get("tool_model_pairs")
        if not isinstance(pairs, list) or len(pairs) <= 1:
            continue
        for i, pair in enumerate(pairs[1:], start=1):
            agent, model = _split_tool_model(pair)
            key = (agent, model)
            row = rows.setdefault(key, {
                "agent": agent, "model": model, "commits": 0,
                "total_added_lines": 0, "ai_code_lines": 0, "ai_accepted_lines": 0,
                "mixed_added_lines": 0, "ai_generated_lines": 0, "ai_deleted_lines": 0,
            })
            row["commits"] += 1
            row["total_added_lines"] += total_added
            row["ai_code_lines"] += _metric_at(evt_data.get("ai_additions"), i)
            row["ai_accepted_lines"] += _metric_at(evt_data.get("ai_accepted"), i)
            row["mixed_added_lines"] += _metric_at(evt_data.get("mixed_additions"), i)
            row["ai_generated_lines"] += _metric_at(evt_data.get("total_ai_additions"), i)
            row["ai_deleted_lines"] += _metric_at(evt_data.get("total_ai_deletions"), i)

    pivot = []
    for row in rows.values():
        total_added = row["total_added_lines"]
        ai_code = row["ai_code_lines"]
        generated = row["ai_generated_lines"]
        row["ai_code_pct"] = min(100, round(ai_code / total_added * 100, 1)) if total_added > 0 else 0
        row["conversion_pct"] = round(ai_code / generated * 100, 1) if generated > 0 else 0
        row["mixed_pct"] = round(row["mixed_added_lines"] / ai_code * 100, 1) if ai_code > 0 else 0
        pivot.append(row)

    return sorted(pivot, key=lambda x: (x["ai_code_lines"], x["ai_code_pct"], x["commits"]), reverse=True)[:30]


# ============================================================
#  /ranking (支持时间筛选) - 批量查询优化
# ============================================================
@router.get("/ranking")
async def ranking(
    days: int = Query(default=0, description="0=全部, 1=当日, 7=近7天, 30=近30天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"ranking": []}

    since = _since_for_days(days)

    result = await db.execute(select(Member).where(Member.team_id == team.id).limit(100))
    members = result.scalars().all()

    # 批量加载所有成员详情
    details = await _batch_member_details(db, list(members), since)

    ranking_list = []
    for m in members:
        detail = details.get(m.id)
        if not detail:
            continue
        ranking_list.append({
            "id": m.id, "name": m.name, "distinct_id": m.distinct_id,
            "contribution": detail["contribution"],
            "ai_lines": detail["ai_lines"], "human_lines": detail["human_lines"],
            "ai_deleted": detail["ai_deleted"], "ai_pct": detail["ai_pct"],
            "mixed_added_lines": detail["mixed_added_lines"],
            "ai_accepted_lines": detail["ai_accepted_lines"],
            "total_added_lines": detail["total_added_lines"],
            "total_deleted_lines": detail["total_deleted_lines"],
            "total_edit_lines": detail["total_edit_lines"],
            "ai_edit_lines": detail["ai_edit_lines"],
            "ai_activity_lines": detail["ai_activity_lines"],
            "ai_code_pct": detail["ai_code_pct"],
            "prompt_message_count": detail["prompt_message_count"],
            "commits": detail["commit_count"], "edits": detail["edit_count"],
            "active_days": detail["active_days"],
            "agents_used": len(detail["agents"]),
            "models_used": len(detail["models"]),
        })

    ranking_list.sort(key=lambda x: (x["ai_lines"], x["ai_code_pct"], x["commits"]), reverse=True)
    for i, item in enumerate(ranking_list): item["rank"] = i + 1

    return {"ranking": ranking_list, "total": len(ranking_list)}


# ============================================================
#  /timeline (支持人员筛选)
# ============================================================
@router.get("/timeline")
async def timeline(
    days: int = Query(default=30, le=365),
    member_id: str = Query(default="", description="空=全员"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"timeline": []}

    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"timeline": []}

    start_date = _start_for_days(days)

    if member_id and member_id in member_ids:
        query = text("""
            SELECT DATE(created_at) as day, COUNT(*) as events,
                   SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
                   SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
            FROM metric_events WHERE member_id = :mid AND created_at >= :sd
            GROUP BY DATE(created_at) ORDER BY day ASC
        """)
        result = await db.execute(query, {"mid": member_id, "sd": start_date.isoformat()})
        return {"timeline": [
            {"date": r[0], "commits": r[2], "edits": r[3], "events": r[1]} for r in result.all()
        ]}

    query = text("""
        SELECT DATE(created_at) as day, COUNT(*) as events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               SUM(CASE WHEN event_type = 2 THEN 1 ELSE 0 END) as agent_usages,
                SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits,
               COUNT(DISTINCT member_id) as unique_users
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND created_at >= :sd GROUP BY DATE(created_at) ORDER BY day ASC
    """)
    result = await db.execute(query, {"tid": team.id, "sd": start_date.isoformat()})
    return {"timeline": [
        {"date": r[0], "events": r[1], "commits": r[2], "agent_usages": r[3],
         "edits": r[4], "unique_users": r[5]} for r in result.all()
    ]}


# ============================================================
#  /agents - 消除 N+1 查询
# ============================================================
@router.get("/agents")
async def agents(db: AsyncSession = Depends(get_db), api_key: str = Header(None, alias="X-API-Key")):
    team = await get_team(db, api_key)
    if not team: return {"agents": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"agents": []}

    query = text("""
        SELECT json_extract(event_data, '$.tool') as a, COUNT(*) as c,
               COUNT(DISTINCT member_id) as u
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND json_extract(event_data, '$.tool') IS NOT NULL AND json_extract(event_data, '$.tool') != ''
        GROUP BY a ORDER BY c DESC LIMIT 20
    """)
    result = await db.execute(query, {"tid": team.id})
    agents_rows = result.all()

    # 批量查询所有 agent 的 model 分布
    agent_names = [r[0] for r in agents_rows if r[0]]
    models_by_agent: dict[str, list[dict]] = {}
    if agent_names:
        placeholders = ",".join(f":a{i}" for i in range(len(agent_names)))
        params = {"tid": team.id}
        for i, name in enumerate(agent_names):
            params[f"a{i}"] = name
        model_query = text(f"""
            SELECT json_extract(event_data, '$.tool') as a,
                   json_extract(event_data, '$.model') as m, COUNT(*) as c
            FROM metric_events
            WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
              AND json_extract(event_data, '$.tool') IN ({placeholders})
              AND json_extract(event_data, '$.model') IS NOT NULL
            GROUP BY a, m ORDER BY a, c DESC
        """)
        model_result = await db.execute(model_query, params)
        for a, m, c in model_result.all():
            agent_models = models_by_agent.setdefault(a, [])
            if len(agent_models) < 5:
                agent_models.append({"name": m or "unknown", "count": c})

    agents_list = []
    for r in agents_rows:
        agent_name = r[0] or "unknown"
        agents_list.append({
            "name": agent_name, "usage_count": r[1], "user_count": r[2],
            "models": models_by_agent.get(r[0], []),
        })
    return {"agents": agents_list}


# ============================================================
#  /models
# ============================================================
@router.get("/models")
async def models(db: AsyncSession = Depends(get_db), api_key: str = Header(None, alias="X-API-Key")):
    team = await get_team(db, api_key)
    if not team: return {"models": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"models": []}

    query = text("""
        SELECT json_extract(event_data, '$.model') as m, COUNT(*) as c,
               COUNT(DISTINCT member_id) as u
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND json_extract(event_data, '$.model') IS NOT NULL AND json_extract(event_data, '$.model') != ''
        GROUP BY m ORDER BY c DESC LIMIT 20
    """)
    result = await db.execute(query, {"tid": team.id})
    return {"models": [
        {"name": r[0] or "unknown", "usage_count": r[1], "user_count": r[2]} for r in result.all()
    ]}


# ============================================================
#  /agent-model-pivot
# ============================================================
@router.get("/agent-model-pivot")
async def agent_model_pivot(
    days: int = Query(default=0, description="0=全部, 1=当日, 7/30=近N天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"rows": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"rows": []}

    conds = [
        MetricEvent.member_id.in_(member_ids),
        MetricEvent.event_type == 1,
    ]
    if days > 0:
        conds.append(MetricEvent.created_at >= _start_for_days(days))
    result = await db.execute(select(MetricEvent.member_id, MetricEvent.event_data).where(*conds))

    rows: dict[tuple[str, str], dict] = {}
    for member_id, evt_data in result.all():
        if not isinstance(evt_data, dict):
            continue
        total_added = _commit_metrics(evt_data)["total_added"]
        pairs = evt_data.get("tool_model_pairs")
        if not isinstance(pairs, list) or len(pairs) <= 1:
            continue
        for i, pair in enumerate(pairs[1:], start=1):
            agent, model = _split_tool_model(pair)
            key = (agent, model)
            row = rows.setdefault(key, {
                "agent": agent, "model": model, "commits": 0, "users": set(),
                "total_added_lines": 0, "ai_code_lines": 0, "ai_accepted_lines": 0,
                "mixed_added_lines": 0, "ai_generated_lines": 0, "ai_deleted_lines": 0,
            })
            row["commits"] += 1
            row["users"].add(member_id)
            row["total_added_lines"] += total_added
            row["ai_code_lines"] += _metric_at(evt_data.get("ai_additions"), i)
            row["ai_accepted_lines"] += _metric_at(evt_data.get("ai_accepted"), i)
            row["mixed_added_lines"] += _metric_at(evt_data.get("mixed_additions"), i)
            row["ai_generated_lines"] += _metric_at(evt_data.get("total_ai_additions"), i)
            row["ai_deleted_lines"] += _metric_at(evt_data.get("total_ai_deletions"), i)

    pivot = []
    for row in rows.values():
        users = row.pop("users")
        total_added = row["total_added_lines"]
        ai_code = row["ai_code_lines"]
        generated = row["ai_generated_lines"]
        row["user_count"] = len(users)
        row["ai_code_pct"] = min(100, round(ai_code / total_added * 100, 1)) if total_added > 0 else 0
        row["conversion_pct"] = round(ai_code / generated * 100, 1) if generated > 0 else 0
        row["mixed_pct"] = round(row["mixed_added_lines"] / ai_code * 100, 1) if ai_code > 0 else 0
        pivot.append(row)

    pivot.sort(key=lambda x: (x["ai_code_lines"], x["ai_code_pct"], x["commits"]), reverse=True)
    return {"rows": pivot}


# ============================================================
#  /repos
# ============================================================
@router.get("/repos")
async def repos(db: AsyncSession = Depends(get_db), api_key: str = Header(None, alias="X-API-Key")):
    team = await get_team(db, api_key)
    if not team: return {"repos": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"repos": []}

    query = text("""
        SELECT repo_url, COUNT(*) as commits,
               COUNT(DISTINCT member_id) as contributors, MAX(created_at) as last_act,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND repo_url IS NOT NULL AND repo_url != ''
        GROUP BY repo_url ORDER BY commits DESC LIMIT 20
    """)
    result = await db.execute(query, {"tid": team.id})
    repos_list = []
    for r in result.all():
        la = r[3]
        if hasattr(la, 'isoformat'): la = la.isoformat()
        repos_list.append({
            "repo_url": r[0], "commit_count": r[1], "contributor_count": r[2],
            "last_activity": str(la) if la else None, "edit_count": r[4],
        })
    return {"repos": repos_list}


# ============================================================
#  /weekly
# ============================================================
@router.get("/weekly")
async def weekly(db: AsyncSession = Depends(get_db), api_key: str = Header(None, alias="X-API-Key")):
    team = await get_team(db, api_key)
    if not team: return {"weeks": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"weeks": []}

    start_date = datetime.now(timezone.utc) - timedelta(weeks=12)
    query = text("""
        SELECT strftime('%Y-W%W', created_at) as wk, COUNT(*) as ev,
               COUNT(DISTINCT member_id) as us,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as cm,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as ed
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND created_at >= :sd GROUP BY wk ORDER BY wk ASC
    """)
    result = await db.execute(query, {"tid": team.id, "sd": start_date.isoformat()})
    return {"weeks": [
        {"week": r[0], "events": r[1], "unique_users": r[2], "commits": r[3], "edits": r[4]}
        for r in result.all()
    ]}


# ============================================================
#  /members - 人员列表 (供下拉筛选)
# ============================================================
@router.get("/members")
async def member_list(db: AsyncSession = Depends(get_db), api_key: str = Header(None, alias="X-API-Key")):
    team = await get_team(db, api_key)
    if not team: return {"members": []}
    result = await db.execute(
        select(Member.id, Member.name, Member.distinct_id).where(Member.team_id == team.id).order_by(Member.name))
    return {"members": [{"id": r[0], "name": r[1], "distinct_id": r[2]} for r in result.all()]}


# ============================================================
#  /efficiency-trend  个人/团队效率趋势
# ============================================================
@router.get("/efficiency-trend")
async def efficiency_trend(
    member_id: str = Query(default="", description="空=团队汇总"),
    days: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"trend": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"trend": []}

    start_date = _start_for_days(days)

    if member_id and member_id in member_ids:
        result = await db.execute(
            select(func.date(MetricEvent.created_at), MetricEvent.event_data)
            .where(MetricEvent.member_id == member_id,
                   MetricEvent.event_type == 1,
                   MetricEvent.created_at >= start_date)
            .order_by(MetricEvent.created_at))
        daily_committed: dict[str, list[dict]] = {}
        for day, evt_data in result.all():
            daily_committed.setdefault(str(day), []).append(evt_data)

        edit_query = text("""
            SELECT DATE(created_at) as day, COUNT(*) as edits
            FROM metric_events WHERE member_id = :mid AND event_type = 4
              AND created_at >= :sd GROUP BY DATE(created_at)
        """)
        edit_result = await db.execute(edit_query, {"mid": member_id, "sd": start_date.isoformat()})
        daily_edits = {str(r[0]): r[1] for r in edit_result.all()}

        all_days = sorted(set(list(daily_committed.keys()) + list(daily_edits.keys())))
        trend_list = []
        for day in all_days:
            committed_list = [(d,) for d in daily_committed.get(day, []) if isinstance(d, dict)]
            ai_l, _, human_l = _parse_committed(committed_list)
            total = ai_l + human_l
            trend_list.append({
                "date": day,
                "ai_lines": ai_l,
                "human_lines": human_l,
                "ai_pct": round(ai_l / total * 100, 1) if total > 0 else 0,
                "commits": len(committed_list),
                "edits": daily_edits.get(day, 0),
            })
        return {"trend": trend_list}

    # 团队趋势
    result = await db.execute(
        select(func.date(MetricEvent.created_at), MetricEvent.event_data, MetricEvent.member_id)
        .where(MetricEvent.member_id.in_(member_ids),
               MetricEvent.event_type == 1,
               MetricEvent.created_at >= start_date)
        .order_by(MetricEvent.created_at))
    daily_committed: dict[str, list[dict]] = {}
    daily_users: dict[str, set] = {}
    for day, evt_data, mid in result.all():
        d = str(day)
        daily_committed.setdefault(d, []).append(evt_data)
        daily_users.setdefault(d, set()).add(mid)

    edit_query = text("""
        SELECT DATE(created_at) as day, COUNT(*) as edits
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND event_type = 4
          AND created_at >= :sd
        GROUP BY DATE(created_at)
    """)
    edit_result = await db.execute(edit_query, {"tid": team.id, "sd": start_date.isoformat()})
    daily_edits = {str(r[0]): r[1] for r in edit_result.all()}

    all_days = sorted(set(list(daily_committed.keys()) + list(daily_edits.keys())))
    trend_list = []
    for day in all_days:
        committed_list = [(d,) for d in daily_committed.get(day, []) if isinstance(d, dict)]
        ai_l, _, human_l = _parse_committed(committed_list)
        total = ai_l + human_l
        trend_list.append({
            "date": day,
            "total_ai_lines": ai_l,
            "total_human_lines": human_l,
            "avg_ai_pct": round(ai_l / total * 100, 1) if total > 0 else 0,
            "total_commits": len(committed_list),
            "total_edits": daily_edits.get(day, 0),
            "active_users": len(daily_users.get(day, set())),
        })
    return {"trend": trend_list}


# ============================================================
#  /ai-code-trend  AI 代码占比趋势
# ============================================================
@router.get("/ai-code-trend")
async def ai_code_trend(
    member_id: str = Query(default="", description="空=团队汇总"),
    days: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"trend": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"trend": []}

    start_date = _start_for_days(days)
    mids = [member_id] if member_id and member_id in member_ids else member_ids
    result = await db.execute(
        select(func.date(MetricEvent.created_at), MetricEvent.event_data)
        .where(MetricEvent.member_id.in_(mids),
               MetricEvent.event_type == 1,
               MetricEvent.created_at >= start_date)
        .order_by(MetricEvent.created_at))

    daily: dict[str, list[tuple]] = {}
    for day, evt_data in result.all():
        daily.setdefault(str(day), []).append((evt_data,))

    trend = []
    for day in sorted(daily.keys()):
        totals = _aggregate_commits(daily[day])
        non_ai_code = max(0, totals["total_added"] - totals["ai_added"])
        trend.append({
            "date": day,
            "ai_added_lines": totals["ai_added"],
            "non_ai_added_lines": totals["non_ai_added"],
            "ai_deleted_lines": totals["ai_deleted"],
            "mixed_added_lines": totals["mixed_added"],
            "ai_accepted_lines": totals["ai_accepted"],
            "ai_edit_lines": totals["ai_edit"],
            "non_ai_edit_lines": non_ai_code,
            "total_added_lines": totals["total_added"],
            "total_edit_lines": totals["total_edit"],
            "ai_code_pct": totals["ai_code_pct"],
            "commit_count": len(daily[day]),
        })
    return {"trend": trend}


# ============================================================
#  /language-trend  Agent 代码按语言分布趋势
# ============================================================
@router.get("/language-trend")
async def language_trend(
    days: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"trend": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"trend": []}

    start_date = _start_for_days(days)
    result = await db.execute(
        select(func.date(MetricEvent.created_at), MetricEvent.event_data)
        .where(MetricEvent.member_id.in_(member_ids),
               MetricEvent.event_type == 4,
               MetricEvent.created_at >= start_date)
        .order_by(MetricEvent.created_at))

    buckets: dict[tuple[str, str], dict] = {}
    for day, evt_data in result.all():
        if not isinstance(evt_data, dict):
            continue
        ext = _file_ext(evt_data.get("file_path"))
        added = _sum_num(evt_data.get("lines_added_sloc")) or _sum_num(evt_data.get("lines_added"))
        key = (str(day), ext)
        bucket = buckets.setdefault(key, {"date": str(day), "extension": ext, "total_added_lines": 0, "ai_added_lines": 0})
        bucket["total_added_lines"] += added
        if str(evt_data.get("kind") or "").lower() in AI_KINDS:
            bucket["ai_added_lines"] += added

    return {"trend": sorted(buckets.values(), key=lambda x: (x["date"], x["extension"]))}


# ============================================================
#  /repo-stats  增强版仓库统计 (含AI贡献度) - 批量查询优化
# ============================================================
@router.get("/repo-stats")
async def repo_stats(
    days: int = Query(default=0, description="0=全部, 1=当日, 7/30=近N天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"repos": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"repos": []}

    since = _since_for_days(days)

    # 基本统计: 按仓库聚合 (top 15)
    base_query = text("""
        SELECT repo_url,
               COUNT(*) as total_events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               COUNT(DISTINCT member_id) as contributors,
               SUM(CASE WHEN event_type = 4 AND json_extract(event_data, '$.kind') IN ('ai_agent', 'ai_tab') THEN 1 ELSE 0 END) as edits,
               MAX(created_at) as last_act
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND repo_url IS NOT NULL AND repo_url != ''
          AND (:sd IS NULL OR created_at >= :sd)
        GROUP BY repo_url ORDER BY commits DESC LIMIT 15
    """)
    base_result = await db.execute(base_query, {"tid": team.id, "sd": since.isoformat() if since else None})
    base_rows = base_result.all()

    if not base_rows:
        return {"repos": []}

    repo_urls = [r[0] for r in base_rows]

    # 批量加载所有仓库的 commit event_data
    commit_conds = [
        MetricEvent.member_id.in_(member_ids),
        MetricEvent.event_type == 1,
        MetricEvent.repo_url.in_(repo_urls),
    ]
    if since: commit_conds.append(MetricEvent.created_at >= since)
    result = await db.execute(
        select(MetricEvent.repo_url, MetricEvent.event_data).where(*commit_conds))
    commits_by_repo: dict[str, list[tuple]] = {}
    for repo_url, evt_data in result.all():
        commits_by_repo.setdefault(repo_url, []).append((evt_data,))

    # 批量加载所有仓库的 prompt 消息计数
    prompt_counts = await _prompt_count_by_repo(db, repo_urls, since)

    # 批量加载所有仓库的 top 3 贡献者
    if repo_urls:
        r_placeholders = ",".join(f":r{i}" for i in range(len(repo_urls)))
        params = {"tid": team.id}
        for i, url in enumerate(repo_urls):
            params[f"r{i}"] = url
        if since:
            params["sd"] = since.isoformat()
            top_query_sql = f"""
                SELECT me.repo_url, m.name, COUNT(*) as cnt
                FROM metric_events me JOIN members m ON me.member_id = m.id
                WHERE me.repo_url IN ({r_placeholders}) AND me.event_type = 1
                  AND me.member_id IN (SELECT id FROM members WHERE team_id = :tid)
                  AND me.created_at >= :sd
                GROUP BY me.repo_url, me.member_id ORDER BY me.repo_url, cnt DESC
            """
        else:
            top_query_sql = f"""
                SELECT me.repo_url, m.name, COUNT(*) as cnt
                FROM metric_events me JOIN members m ON me.member_id = m.id
                WHERE me.repo_url IN ({r_placeholders}) AND me.event_type = 1
                  AND me.member_id IN (SELECT id FROM members WHERE team_id = :tid)
                GROUP BY me.repo_url, me.member_id ORDER BY me.repo_url, cnt DESC
            """
        top_result = await db.execute(text(top_query_sql), params)
        top_by_repo: dict[str, list[dict]] = {}
        for repo_url, name, cnt in top_result.all():
            contributors = top_by_repo.setdefault(repo_url, [])
            if len(contributors) < 3:
                contributors.append({"name": name or "unknown", "commits": cnt})
    else:
        top_by_repo = {}

    repos_list = []
    for r in base_rows:
        repo_url = r[0]
        commit_count = r[2]
        contributor_count = r[3]
        edit_count = r[4]
        last_act = r[5]
        if hasattr(last_act, 'isoformat'):
            last_act = last_act.isoformat()

        repo_name = repo_url.rstrip("/").rsplit("/", 1)[-1] if repo_url else "unknown"
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]

        committed = commits_by_repo.get(repo_url, [])
        totals = _aggregate_commits(committed)
        ai_lines = totals["ai_added"]
        human_lines = totals["human_added"]
        ai_pct = totals["ai_code_pct"]

        repos_list.append({
            "repo_url": repo_url,
            "repo_name": repo_name,
            "commit_count": commit_count,
            "contributor_count": contributor_count,
            "edit_count": edit_count,
            "ai_lines": ai_lines,
            "human_lines": human_lines,
            "ai_pct": ai_pct,
            "mixed_added_lines": totals["mixed_added"],
            "ai_accepted_lines": totals["ai_accepted"],
            "total_added_lines": totals["total_added"],
            "total_deleted_lines": totals["total_deleted"],
            "total_edit_lines": totals["total_edit"],
            "ai_edit_lines": totals["ai_edit"],
            "ai_activity_lines": totals["ai_activity"],
            "prompt_message_count": prompt_counts.get(repo_url, 0),
            "top_contributors": top_by_repo.get(repo_url, []),
            "last_activity": str(last_act) if last_act else None,
        })

    repos_list.sort(key=lambda x: (x["ai_lines"], x["ai_pct"], x["commit_count"]), reverse=True)
    return {"repos": repos_list}


# ============================================================
#  /time-distribution  24小时活跃度分布
# ============================================================
@router.get("/time-distribution")
async def time_distribution(
    member_id: str = Query(default="", description="空=全员"),
    days: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team: return {"distribution": [], "peak_hours": []}
    member_ids = await get_member_ids(db, team.id)
    if not member_ids: return {"distribution": [], "peak_hours": []}

    start_date = _start_for_days(days)

    if member_id and member_id in member_ids:
        query = text("""
            SELECT CAST(strftime('%H', datetime(created_at, '+8 hours')) AS INTEGER) as hour,
                   COUNT(*) as events,
                   SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
                   SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
            FROM metric_events
            WHERE member_id = :mid AND created_at >= :sd
            GROUP BY hour ORDER BY hour ASC
        """)
        result = await db.execute(query, {"mid": member_id, "sd": start_date.isoformat()})
    else:
        query = text("""
            SELECT CAST(strftime('%H', datetime(created_at, '+8 hours')) AS INTEGER) as hour,
                   COUNT(*) as events,
                   SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
                   SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
            FROM metric_events
            WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
              AND created_at >= :sd
            GROUP BY hour ORDER BY hour ASC
        """)
        result = await db.execute(query, {"tid": team.id, "sd": start_date.isoformat()})

    hour_map = {r[0]: {"hour": r[0], "events": r[1], "commits": r[2], "edits": r[3]} for r in result.all()}
    distribution = []
    for h in range(24):
        distribution.append(hour_map.get(h, {"hour": h, "events": 0, "commits": 0, "edits": 0}))

    sorted_hours = sorted(distribution, key=lambda x: x["events"], reverse=True)
    peak_hours = [h["hour"] for h in sorted_hours[:3] if h["events"] > 0]

    return {"distribution": distribution, "peak_hours": peak_hours}


# ============================================================
#  /dashboard 聚合接口 - 一次查询返回所有面板数据
#  消除 12 路并行 HTTP 请求导致的 SQLite 锁争用
# ============================================================
@router.get("/dashboard")
async def dashboard_data(
    days: int = Query(default=30, le=365, description="0=全部, 1=当日, 7/30=近N天"),
    db: AsyncSession = Depends(get_db),
    api_key: str = Header(None, alias="X-API-Key"),
):
    team = await get_team(db, api_key)
    if not team:
        return {"error": "No team found"}

    member_ids = await get_member_ids(db, team.id)
    since = _since_for_days(days) if days > 0 else None
    start_date = _start_for_days(days) if days > 0 else (datetime.now(timezone.utc) - timedelta(days=30))

    # 基础条件
    event_conds = [MetricEvent.member_id.in_(member_ids)]
    commit_conds = [*event_conds, MetricEvent.event_type == 1]
    edit_conds = [*event_conds, MetricEvent.event_type == 4]
    if since:
        event_conds.append(MetricEvent.created_at >= since)
        commit_conds.append(MetricEvent.created_at >= since)
        edit_conds.append(MetricEvent.created_at >= since)

    # 成员
    result = await db.execute(select(Member).where(Member.team_id == team.id).order_by(Member.created_at.desc()).limit(100))
    members = result.scalars().all()
    member_ids_active = [m.id for m in members]

    # === overview - 只做必要的查询 ===
    total_cas = await db.scalar(select(func.count(CasObject.id)).where(CasObject.member_id.in_(member_ids_active))) or 0
    total_bundles = await db.scalar(select(func.count(Bundle.id)).where(Bundle.member_id.in_(member_ids_active))) or 0
    total_events = await db.scalar(select(func.count(MetricEvent.id)).where(*event_conds)) or 0

    result = await db.execute(select(MetricEvent.event_data).where(*commit_conds))
    committed = [(evt_data,) for (evt_data,) in result.all()]
    commit_totals = _aggregate_commits(committed)
    total_commits = len(committed)

    total_edit_count = await db.scalar(select(func.count(MetricEvent.id)).where(*edit_conds)) or 0
    ai_edit_count = await db.scalar(
        select(func.count(MetricEvent.id)).where(*edit_conds, MetricEvent.event_data["kind"].as_string().in_(list(AI_KINDS)))) or 0

    prompt_message_count = await _prompt_count_for_members(db, member_ids_active, since)

    now_ts = datetime.now(timezone.utc)
    week_ago = now_ts - timedelta(days=7)
    month_ago = now_ts - timedelta(days=30)
    active_7d = await db.scalar(select(func.count(func.distinct(MetricEvent.member_id))).where(MetricEvent.member_id.in_(member_ids_active), MetricEvent.created_at >= week_ago)) or 0
    active_30d = await db.scalar(select(func.count(func.distinct(MetricEvent.member_id))).where(MetricEvent.member_id.in_(member_ids_active), MetricEvent.created_at >= month_ago)) or 0

    ai_lines = commit_totals["ai_added"]
    human = commit_totals["human_added"]
    total_all = ai_lines + human
    acc_rate = round(ai_lines / total_all * 100, 1) if total_all > 0 else 0
    team_score = acc_rate * 0.60 + min(active_7d / max(1, len(member_ids_active)) * 100, 100) * 0.40

    p1_start = week_ago - timedelta(days=7)
    p1 = await db.scalar(select(func.count(MetricEvent.id)).where(MetricEvent.member_id.in_(member_ids_active), MetricEvent.created_at >= p1_start, MetricEvent.created_at < week_ago)) or 0
    p2 = await db.scalar(select(func.count(MetricEvent.id)).where(MetricEvent.member_id.in_(member_ids_active), MetricEvent.created_at >= week_ago)) or 0
    if p1 > 0:
        chg = (p2 - p1) / p1
        trend = "up" if chg > 0.15 else "down" if chg < -0.15 else "stable"
    else:
        trend = "up" if p2 > 0 else "stable"

    overview_data = {
        "member_count": len(member_ids_active), "total_commits": total_commits,
        "total_events": total_events, "total_edit_count": total_edit_count,
        "total_cas": total_cas, "total_bundles": total_bundles,
        "active_users_7d": active_7d, "active_users_30d": active_30d,
        "ai_acceptance_rate": acc_rate,
        "total_ai_lines": ai_lines, "total_human_lines": human,
        "total_ai_deleted": commit_totals["ai_deleted"],
        "mixed_added_lines": commit_totals["mixed_added"],
        "ai_accepted_lines": commit_totals["ai_accepted"],
        "ai_activity_lines": commit_totals["ai_activity"],
        "total_added_lines": commit_totals["total_added"],
        "total_deleted_lines": commit_totals["total_deleted"],
        "total_edit_lines": commit_totals["total_edit"],
        "ai_edit_lines": commit_totals["ai_edit"],
        "ai_code_pct": commit_totals["ai_code_pct"],
        "agent_edit_count": ai_edit_count,
        "prompt_message_count": prompt_message_count,
        "team_ai_score": round(team_score, 1), "trend": trend,
        "avg_ai_lines_per_commit": round(ai_lines / total_commits) if total_commits > 0 else 0,
    }

    # === ranking - 复用 batch_member_details ===
    details = await _batch_member_details(db, list(members), since)
    ranking_list = []
    for m in members:
        d = details.get(m.id)
        if not d: continue
        ranking_list.append({
            "id": m.id, "name": m.name, "distinct_id": m.distinct_id,
            "contribution": d["contribution"],
            "ai_lines": d["ai_lines"], "human_lines": d["human_lines"],
            "ai_pct": d["ai_pct"], "ai_code_pct": d["ai_code_pct"],
            "total_added_lines": d["total_added_lines"],
            "total_edit_lines": d["total_edit_lines"],
            "ai_edit_lines": d["ai_edit_lines"],
            "prompt_message_count": d["prompt_message_count"],
            "commits": d["commit_count"], "edits": d["edit_count"],
            "active_days": d["active_days"],
            "agents_used": len(d["agents"]), "models_used": len(d["models"]),
        })
    ranking_list.sort(key=lambda x: (x["ai_lines"], x["ai_code_pct"], x["commits"]), reverse=True)
    for i, item in enumerate(ranking_list): item["rank"] = i + 1

    # === repos ===
    repo_query = text("""
        SELECT repo_url,
               COUNT(*) as total_events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               COUNT(DISTINCT member_id) as contributors,
               SUM(CASE WHEN event_type = 4 AND json_extract(event_data, '$.kind') IN ('ai_agent', 'ai_tab') THEN 1 ELSE 0 END) as edits,
               MAX(created_at) as last_act
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND repo_url IS NOT NULL AND repo_url != ''
          AND (:sd IS NULL OR created_at >= :sd)
        GROUP BY repo_url ORDER BY commits DESC LIMIT 15
    """)
    repo_result = await db.execute(repo_query, {"tid": team.id, "sd": since.isoformat() if since else None})
    repo_rows = repo_result.all()
    repo_urls = [r[0] for r in repo_rows]

    commits_by_repo: dict[str, list[tuple]] = {}
    if repo_urls:
        repo_commit_conds = [
            MetricEvent.member_id.in_(member_ids_active),
            MetricEvent.event_type == 1,
            MetricEvent.repo_url.in_(repo_urls),
        ]
        if since:
            repo_commit_conds.append(MetricEvent.created_at >= since)
        result = await db.execute(select(MetricEvent.repo_url, MetricEvent.event_data).where(*repo_commit_conds))
        for repo_url, evt_data in result.all():
            commits_by_repo.setdefault(repo_url, []).append((evt_data,))

    prompt_counts = await _prompt_count_by_repo(db, repo_urls, since)

    top_by_repo: dict[str, list[dict]] = {}
    if repo_urls:
        r_placeholders = ",".join(f":r{i}" for i in range(len(repo_urls)))
        params = {"tid": team.id}
        for i, url in enumerate(repo_urls):
            params[f"r{i}"] = url
        since_filter = "AND me.created_at >= :sd" if since else ""
        if since:
            params["sd"] = since.isoformat()
        top_query = text(f"""
            SELECT me.repo_url, m.name, COUNT(*) as cnt
            FROM metric_events me JOIN members m ON me.member_id = m.id
            WHERE me.repo_url IN ({r_placeholders}) AND me.event_type = 1
              AND me.member_id IN (SELECT id FROM members WHERE team_id = :tid)
              {since_filter}
            GROUP BY me.repo_url, me.member_id ORDER BY me.repo_url, cnt DESC
        """)
        top_result = await db.execute(top_query, params)
        for repo_url, name, cnt in top_result.all():
            contributors = top_by_repo.setdefault(repo_url, [])
            if len(contributors) < 3:
                contributors.append({"name": name or "unknown", "commits": cnt})

    repos_list = []
    for r in repo_rows:
        repo_url = r[0]
        last_act = r[5]
        if hasattr(last_act, 'isoformat'):
            last_act = last_act.isoformat()
        repo_name = repo_url.rstrip("/").rsplit("/", 1)[-1] if repo_url else "unknown"
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]
        totals = _aggregate_commits(commits_by_repo.get(repo_url, []))
        repos_list.append({
            "repo_url": repo_url,
            "repo_name": repo_name,
            "commit_count": r[2],
            "contributor_count": r[3],
            "edit_count": r[4],
            "ai_lines": totals["ai_added"],
            "human_lines": totals["human_added"],
            "ai_pct": totals["ai_code_pct"],
            "mixed_added_lines": totals["mixed_added"],
            "ai_accepted_lines": totals["ai_accepted"],
            "total_added_lines": totals["total_added"],
            "total_deleted_lines": totals["total_deleted"],
            "total_edit_lines": totals["total_edit"],
            "ai_edit_lines": totals["ai_edit"],
            "ai_activity_lines": totals["ai_activity"],
            "prompt_message_count": prompt_counts.get(repo_url, 0),
            "top_contributors": top_by_repo.get(repo_url, []),
            "last_activity": str(last_act) if last_act else None,
        })
    repos_list.sort(key=lambda x: (x["ai_lines"], x["ai_pct"], x["commit_count"]), reverse=True)

    # === models (lightweight) ===
    models_query = text("""
        SELECT json_extract(event_data, '$.model') as m, COUNT(*) as c,
               COUNT(DISTINCT member_id) as u
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND json_extract(event_data, '$.model') IS NOT NULL AND json_extract(event_data, '$.model') != ''
        GROUP BY m ORDER BY c DESC LIMIT 20
    """)
    models_result = await db.execute(models_query, {"tid": team.id})
    models_list = [{"name": r[0] or "unknown", "usage_count": r[1], "user_count": r[2]} for r in models_result.all()]

    # === timeline ===
    timeline_query = text("""
        SELECT DATE(created_at) as day, COUNT(*) as events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               SUM(CASE WHEN event_type = 2 THEN 1 ELSE 0 END) as agent_usages,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits,
               COUNT(DISTINCT member_id) as unique_users
        FROM metric_events
        WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND created_at >= :sd GROUP BY DATE(created_at) ORDER BY day ASC
    """)
    timeline_result = await db.execute(timeline_query, {"tid": team.id, "sd": start_date.isoformat()})
    timeline_list = [{"date": r[0], "events": r[1], "commits": r[2], "agent_usages": r[3],
                      "edits": r[4], "unique_users": r[5]} for r in timeline_result.all()]

    # === agents (batch query) ===
    agents_query = text("""
        SELECT json_extract(event_data, '$.tool') as a, COUNT(*) as c,
               COUNT(DISTINCT member_id) as u
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND json_extract(event_data, '$.tool') IS NOT NULL AND json_extract(event_data, '$.tool') != ''
        GROUP BY a ORDER BY c DESC LIMIT 20
    """)
    agents_result = await db.execute(agents_query, {"tid": team.id})
    agent_rows = agents_result.all()
    agent_names = [r[0] for r in agent_rows if r[0]]
    agents_by_name: dict[str, list] = {}
    if agent_names:
        a_placeholders = ",".join(f":a{i}" for i in range(len(agent_names)))
        a_params = {"tid": team.id}
        for i, name in enumerate(agent_names): a_params[f"a{i}"] = name
        am_query = text(f"""
            SELECT json_extract(event_data, '$.tool') as a,
                   json_extract(event_data, '$.model') as m, COUNT(*) as c
            FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
              AND json_extract(event_data, '$.tool') IN ({a_placeholders})
              AND json_extract(event_data, '$.model') IS NOT NULL
            GROUP BY a, m ORDER BY a, c DESC
        """)
        am_result = await db.execute(am_query, a_params)
        for a, m, c in am_result.all():
            lst = agents_by_name.setdefault(a, [])
            if len(lst) < 5: lst.append({"name": m or "unknown", "count": c})
    agents_list = [{"name": r[0] or "unknown", "usage_count": r[1], "user_count": r[2],
                    "models": agents_by_name.get(r[0], [])} for r in agent_rows]

    # === agent × model pivot ===
    agent_model_rows: dict[tuple[str, str], dict] = {}
    result = await db.execute(select(MetricEvent.member_id, MetricEvent.event_data).where(*commit_conds))
    for member_id, evt_data in result.all():
        if not isinstance(evt_data, dict):
            continue
        total_added = _commit_metrics(evt_data)["total_added"]
        pairs = evt_data.get("tool_model_pairs")
        if not isinstance(pairs, list) or len(pairs) <= 1:
            continue
        for i, pair in enumerate(pairs[1:], start=1):
            agent, model = _split_tool_model(pair)
            key = (agent, model)
            row = agent_model_rows.setdefault(key, {
                "agent": agent, "model": model, "commits": 0, "users": set(),
                "total_added_lines": 0, "ai_code_lines": 0, "ai_accepted_lines": 0,
                "mixed_added_lines": 0, "ai_generated_lines": 0, "ai_deleted_lines": 0,
            })
            row["commits"] += 1
            row["users"].add(member_id)
            row["total_added_lines"] += total_added
            row["ai_code_lines"] += _metric_at(evt_data.get("ai_additions"), i)
            row["ai_accepted_lines"] += _metric_at(evt_data.get("ai_accepted"), i)
            row["mixed_added_lines"] += _metric_at(evt_data.get("mixed_additions"), i)
            row["ai_generated_lines"] += _metric_at(evt_data.get("total_ai_additions"), i)
            row["ai_deleted_lines"] += _metric_at(evt_data.get("total_ai_deletions"), i)

    agent_model_pivot_rows = []
    for row in agent_model_rows.values():
        users = row.pop("users")
        total_added = row["total_added_lines"]
        ai_code = row["ai_code_lines"]
        generated = row["ai_generated_lines"]
        row["user_count"] = len(users)
        row["ai_code_pct"] = min(100, round(ai_code / total_added * 100, 1)) if total_added > 0 else 0
        row["conversion_pct"] = round(ai_code / generated * 100, 1) if generated > 0 else 0
        row["mixed_pct"] = round(row["mixed_added_lines"] / ai_code * 100, 1) if ai_code > 0 else 0
        agent_model_pivot_rows.append(row)
    agent_model_pivot_rows.sort(key=lambda x: (x["ai_code_lines"], x["ai_code_pct"], x["commits"]), reverse=True)

    # === weekly ===
    weekly_query = text("""
        SELECT strftime('%Y-W%W', created_at) as wk, COUNT(*) as ev,
               COUNT(DISTINCT member_id) as us,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as cm,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as ed
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND created_at >= :sd GROUP BY wk ORDER BY wk ASC
    """)
    ws = datetime.now(timezone.utc) - timedelta(weeks=12)
    weekly_result = await db.execute(weekly_query, {"tid": team.id, "sd": ws.isoformat()})
    weekly_list = [{"week": r[0], "events": r[1], "unique_users": r[2], "commits": r[3], "edits": r[4]} for r in weekly_result.all()]

    # === ai-code-trend ===
    trend_result = await db.execute(
        select(func.date(MetricEvent.created_at), MetricEvent.event_data)
        .where(MetricEvent.member_id.in_(member_ids_active), MetricEvent.event_type == 1, MetricEvent.created_at >= start_date)
        .order_by(MetricEvent.created_at))
    daily: dict[str, list[tuple]] = {}
    for day, evt_data in trend_result.all():
        daily.setdefault(str(day), []).append((evt_data,))
    ai_trend_list = []
    for day in sorted(daily.keys()):
        totals = _aggregate_commits(daily[day])
        ai_trend_list.append({
            "date": day, "ai_added_lines": totals["ai_added"],
            "non_ai_added_lines": totals["non_ai_added"],
            "ai_code_pct": totals["ai_code_pct"],
            "commit_count": len(daily[day]),
        })

    return {
        "overview": overview_data,
        "ranking": ranking_list,
        "total_ranking": len(ranking_list),
        "repos": repos_list,
        "models": models_list,
        "timeline": timeline_list,
        "agents": agents_list,
        "agent_model_pivot": agent_model_pivot_rows,
        "weekly": weekly_list,
        "ai_trend": ai_trend_list,
        "language_trend": await _language_trend_data(db, member_ids_active, start_date),
        "time_distribution": await _time_dist_data(db, team.id, member_ids_active, start_date),
    }


async def _language_trend_data(db, member_ids, start_date):
    result = await db.execute(
        select(func.date(MetricEvent.created_at), MetricEvent.event_data)
        .where(MetricEvent.member_id.in_(member_ids), MetricEvent.event_type == 4,
               MetricEvent.created_at >= start_date)
        .order_by(MetricEvent.created_at))
    buckets: dict[tuple[str, str], dict] = {}
    for day, evt_data in result.all():
        if not isinstance(evt_data, dict): continue
        ext = _file_ext(evt_data.get("file_path"))
        added = _sum_num(evt_data.get("lines_added_sloc")) or _sum_num(evt_data.get("lines_added"))
        key = (str(day), ext)
        b = buckets.setdefault(key, {"date": str(day), "extension": ext, "total_added_lines": 0, "ai_added_lines": 0})
        b["total_added_lines"] += added
        if str(evt_data.get("kind") or "").lower() in AI_KINDS:
            b["ai_added_lines"] += added
    return sorted(buckets.values(), key=lambda x: (x["date"], x["extension"]))


async def _time_dist_data(db, team_id, member_ids, start_date):
    query = text("""
        SELECT CAST(strftime('%H', datetime(created_at, '+8 hours')) AS INTEGER) as hour,
               COUNT(*) as events,
               SUM(CASE WHEN event_type = 1 THEN 1 ELSE 0 END) as commits,
               SUM(CASE WHEN event_type = 4 THEN 1 ELSE 0 END) as edits
        FROM metric_events WHERE member_id IN (SELECT id FROM members WHERE team_id = :tid)
          AND created_at >= :sd GROUP BY hour ORDER BY hour ASC
    """)
    result = await db.execute(query, {"tid": team_id, "sd": start_date.isoformat()})
    hour_map = {r[0]: {"hour": r[0], "events": r[1], "commits": r[2], "edits": r[3]} for r in result.all()}
    distribution = [hour_map.get(h, {"hour": h, "events": 0, "commits": 0, "edits": 0}) for h in range(24)]
    peak_hours = [h["hour"] for h in sorted(distribution, key=lambda x: x["events"], reverse=True)[:3] if h["events"] > 0]
    return {"distribution": distribution, "peak_hours": peak_hours}
