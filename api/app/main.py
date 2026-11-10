from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import Base, engine
from .routers import orgs, schedule, study, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    if get_settings().demo_auth:
        from .seed import seed_demo

        seed_demo()
    yield


app = FastAPI(title="PLARE API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Demo-User"],
)
for r in (orgs.router, tasks.router, schedule.router, study.router):
    app.include_router(r)


@app.get("/health")
def health():
    settings = get_settings()
    return {
        "ok": True,
        "demo_auth": settings.demo_auth,
        "google_sign_in": bool(settings.supabase_url or settings.supabase_jwt_secret),
    }


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
