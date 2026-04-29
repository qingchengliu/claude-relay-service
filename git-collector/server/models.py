import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON
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
    members = relationship("Member", back_populates="team", lazy="selectin")


class Member(Base):
    __tablename__ = "members"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    team_id = Column(String(36), ForeignKey("teams.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    distinct_id = Column(String(128), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=now)
    team = relationship("Team", back_populates="members", lazy="selectin")
    sessions = relationship("Session", back_populates="member", lazy="selectin")
    metric_events = relationship("MetricEvent", back_populates="member", lazy="selectin")


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
    member = relationship("Member", back_populates="sessions", lazy="selectin")


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


class MetricEvent(Base):
    __tablename__ = "metric_events"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    event_type = Column(Integer, nullable=False, index=True)
    event_data = Column(JSON, nullable=False)
    repo_url = Column(String(1024), nullable=True)
    commit_sha = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now, index=True)
    member = relationship("Member", back_populates="metric_events", lazy="selectin")


class Bundle(Base):
    __tablename__ = "bundles"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    member_id = Column(String(36), ForeignKey("members.id"), nullable=True, index=True)
    title = Column(String(512), nullable=False)
    data = Column(JSON, nullable=False)
    bundle_url = Column(String(1024), nullable=True)
    created_at = Column(DateTime, nullable=False, default=now)
