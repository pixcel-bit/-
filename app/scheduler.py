import os
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

_scheduler: AsyncIOScheduler | None = None


def start_scheduler(job_fn):
    global _scheduler
    hour = int(os.environ.get("SCHEDULE_HOUR", "6"))
    minute = int(os.environ.get("SCHEDULE_MINUTE", "0"))

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        job_fn,
        trigger=CronTrigger(hour=hour, minute=minute, timezone="Asia/Tokyo"),
        id="daily_broadcast",
        replace_existing=True,
    )
    _scheduler.start()
    print(f"[scheduler] 毎日 {hour:02d}:{minute:02d} (JST) に自動実行")
