import asyncio
import hmac
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import push, task_automation
from .config import get_settings
from .db import Base, SessionLocal, engine
from .routers import events, gm, group_study, orgs, overview, planner, schedule, study, task_templates, tasks

logger = logging.getLogger("plare.reminders")


def _reminders_once() -> None:
    """One scheduler pass: create due reminders, then push anything new to phones."""
    with SessionLocal() as db:
        gm.send_gm_reminders(db)
    with SessionLocal() as db:
        task_automation.generate_recurring_tasks(db)
    with SessionLocal() as db:
        task_automation.send_task_reminders(db)
    with SessionLocal() as db:
        push.send_pending(db)


async def _reminder_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(_reminders_once)
        except Exception:  # keep the loop alive; the next minute retries
            logger.exception("Reminder run failed")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    if get_settings().demo_auth:
        from .seed import seed_demo

        seed_demo()
    task = asyncio.create_task(_reminder_loop()) if get_settings().run_reminders else None
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="PLARE API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Demo-User"],
)
for r in (orgs.router, tasks.router, task_templates.router, events.router, schedule.router, study.router,
          group_study.router, planner.router, gm.router, overview.router):
    app.include_router(r)


@app.get("/health")
def health():
    settings = get_settings()
    return {
        "ok": True,
        "demo_auth": settings.demo_auth,
        "google_sign_in": bool(settings.supabase_url or settings.supabase_jwt_secret),
    }


@app.post("/cron/tick")
def cron_tick(x_cron_secret: str = Header("")):
    """Run one scheduler pass. For an outside scheduler (like cron-job.org) when the host sleeps
    between requests, as Render's free plan does. Off unless CRON_SECRET is set."""
    secret = get_settings().cron_secret
    if not secret:
        raise HTTPException(404, "Not found")
    if not hmac.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(403, "Wrong cron secret")
    _reminders_once()
    return {"ok": True}


@app.get("/demo/users")
def demo_users():
    """Demo accounts for the sign-in picker. Empty unless demo sign-in is on."""
    if not get_settings().demo_auth:
        return []
    from sqlalchemy import select

    from .db import SessionLocal
    from .models import Membership, User

    with SessionLocal() as db:
        rows = db.scalars(select(Membership).join(User).where(User.is_demo.is_(True))).all()
        return [{"email": m.user.email, "name": m.user.name, "role": m.role} for m in rows]


# Accountability log (appended so existing router wiring stays untouched).
from .routers import log as log_routes  # noqa: E402

app.include_router(log_routes.router)

# Coffee chats.
from .routers import coffee as coffee_routes  # noqa: E402

app.include_router(coffee_routes.router)

# Excused absences (appended for the same reason).
from .routers import excuses as excuse_routes  # noqa: E402

app.include_router(excuse_routes.router)

# Push notification settings.
from .routers import push as push_routes  # noqa: E402

app.include_router(push_routes.router)

# BP check-ins (appended for the same reason).
from .routers import bp as bp_routes  # noqa: E402

app.include_router(bp_routes.router)
