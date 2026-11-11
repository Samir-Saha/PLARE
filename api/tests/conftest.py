import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="plare-test-")
# Set TEST_DATABASE_URL to run the suite against Postgres instead of SQLite.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["DEMO_AUTH"] = "true"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_JWT_SECRET"] = ""
os.environ["RUN_REMINDERS"] = "false"

import pytest
from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import Membership, Organization, Role, User


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    return TestClient(app)


def as_user(email: str) -> dict:
    return {"X-Demo-User": email}


@pytest.fixture
def world():
    """Two orgs. Org A: admin, lead, three members. Org B: one outsider admin."""
    with SessionLocal() as db:
        a, b = Organization(name="A"), Organization(name="B")
        db.add_all([a, b])
        db.flush()
        ids = {"org_a": a.id, "org_b": b.id}
        people = [("admin", Role.admin, a), ("lead", Role.lead, a), ("m1", Role.member, a),
                  ("m2", Role.member, a), ("m3", Role.member, a), ("outsider", Role.admin, b)]
        for name, role, org in people:
            u = User(email=f"{name}@t.demo", name=name, is_demo=True, timezone="America/New_York")
            db.add(u)
            db.flush()
            db.add(Membership(org_id=org.id, user_id=u.id, role=role))
            ids[name] = u.id
        db.commit()
    return ids
