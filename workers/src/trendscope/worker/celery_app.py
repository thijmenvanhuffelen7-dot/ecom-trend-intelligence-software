"""Celery: de scheduler tikt elke minuut, crawls lopen in een eigen wachtrij met prioriteit.

Start lokaal: `make worker` (worker + beat in één proces).
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from trendscope.core.settings import get_settings

settings = get_settings()

app = Celery("trendscope", broker=settings.redis_url, include=["trendscope.worker.tasks"])
app.conf.update(
    task_acks_late=True,  # een taak die halverwege een worker-crash sneuvelt, wordt opnieuw uitgeleverd
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # eerlijk verdelen: lange crawls blokkeren geen korte
    task_default_queue="default",
    task_routes={"trendscope.crawl_target": {"queue": "crawl"}},
    # Redis-prioriteiten: 0 = hoogst. We mappen crawl-prioriteit 0–100 naar 0–9.
    broker_transport_options={"priority_steps": list(range(10)), "sep": ":", "queue_order_strategy": "priority"},
    task_ignore_result=True,
    timezone="UTC",
    beat_schedule={
        "scheduler-tick": {"task": "trendscope.tick", "schedule": 60.0},
        "discovery": {"task": "trendscope.discover", "schedule": crontab(minute=15)},
        "search-index": {"task": "trendscope.reindex_search", "schedule": crontab(minute="*/15")},
        "screenshots": {"task": "trendscope.screenshots", "schedule": crontab(minute=40)},
        "clustering": {"task": "trendscope.cluster", "schedule": crontab(minute="5,35")},
    },
)
