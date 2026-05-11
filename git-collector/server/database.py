import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from .config import DATABASE_URL

if DATABASE_URL.startswith("sqlite"):
    db_path = DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {
        "check_same_thread": False,
        "timeout": 30,           # 写锁等待30秒
    }

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
    pool_size=5,                 # SQLite 不需要大连接池
    pool_pre_ping=True,          # 连接回收前检查有效性
)

# 启动时启用 WAL 模式 + 优化参数
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")       # 读写并发不互斥
        cursor.execute("PRAGMA synchronous=NORMAL")     # 平衡安全性与写入速度
        cursor.execute("PRAGMA busy_timeout=5000")      # 5秒忙等
        cursor.execute("PRAGMA cache_size=-8000")       # 8MB 缓存
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if DATABASE_URL.startswith("sqlite"):
            rows = await conn.execute(text("PRAGMA table_info(prompt_metrics)"))
            columns = {row[1] for row in rows.fetchall()}
            if "parser_version" not in columns:
                await conn.execute(text(
                    "ALTER TABLE prompt_metrics ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0"
                ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_prompt_metrics_parser_version "
                "ON prompt_metrics (parser_version)"
            ))
