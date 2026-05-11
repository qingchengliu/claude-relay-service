import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.database import async_session, engine, init_db
from server.prompt_metrics_backfill import backfill_prompt_metrics


async def main():
    await init_db()
    async with async_session() as db:
        result = await backfill_prompt_metrics(db)
    await engine.dispose()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
