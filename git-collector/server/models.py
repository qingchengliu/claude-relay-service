import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


def gen_uuid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc)


class Team(Base):
    __tablename__ = "teams"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(255), nullable=False, default="Default Team")
    api_key = Column(String(128), unique=True, nullable=False, default=gen_uuid)
    created_at = Column(DateTime, nullable=False, default=now)
    members = relationship("Member", back_populates="team", lazy="select")


class Member(Base):
    __tablename__ = "members"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    team_id = Column(String(36), ForeignKey("teams.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    distinct_id = Column(String(128), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=now)
    team = relationship("Team", back_populates="members", lazy="select")
    sessions = relationship("Session", back_populates="member", lazy="select")
    metric_events = relationship("MetricEvent", back_populates="member", lazy="select")


class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=False, index=True)
    repo_url = Column(String(1024), nullable=True)
    agent_name = Column(String(128), nullable=True, index=True)
    model_name = Column(String(128), nullable=True)
    commit_sha = Column(String(64), nullable=True, index=True)
    ai_lines = Column(Integer, default=0)
    total_lines = Column(Integer, default=0)
    session_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    member = relationship("Member", back_populates="sessions", lazy="select")


class CasObject(Base):
    __tablename__ = "cas_objects"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    hash = Column(String(128), unique=True, nullable=False, index=True)
    content = Column(JSON, nullable=False)
    kind = Column(String(64), nullable=True, default="prompt")
    repo_url = Column(String(1024), nullable=True)
    api_version = Column(String(16), nullable=True, default="v1")
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=now)
    __table_args__ = (
        Index("ix_cas_objects_member_created", "member_id", "created_at"),
    )


class MetricEvent(Base):
    __tablename__ = "metric_events"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    event_type = Column(Integer, nullable=False, index=True)
    event_data = Column(JSON, nullable=False)
    repo_url = Column(String(1024), nullable=True)
    commit_sha = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    member = relationship("Member", back_populates="metric_events", lazy="select")
    __table_args__ = (
        Index("ix_metric_events_member_type_created", "member_id", "event_type", "created_at"),
        Index("ix_metric_events_repo_url", "repo_url"),
    )


class Bundle(Base):
    __tablename__ = "bundles"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    title = Column(String(512), nullable=False)
    data = Column(JSON, nullable=False)
    bundle_url = Column(String(1024), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now)
    __table_args__ = (
        Index("ix_bundles_member_created", "member_id", "created_at"),
    )


class PromptMetric(Base):
    __tablename__ = "prompt_metrics"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    source_type = Column(String(16), nullable=False)
    source_id = Column(String(36), nullable=False)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    repo_url = Column(String(1024), nullable=True)
    prompt_message_count = Column(Integer, nullable=False, default=0)
    total_message_count = Column(Integer, nullable=False, default=0)
    parser_version = Column(Integer, nullable=False, default=1, index=True)
    metric_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", name="uq_prompt_metrics_source"),
        Index("ix_prompt_metrics_member_created", "member_id", "created_at"),
        Index("ix_prompt_metrics_repo_created", "repo_url", "created_at"),
    )
