from datetime import timedelta

from app.db import now

from .conftest import as_user

LEAD = as_user("lead@t.demo")
M1 = as_user("m1@t.demo")


def url(world, suffix="", org="org_a"):
    return f"/orgs/{world[org]}/coffee-chats{suffix}"


def add(client, world, first="Marcus", last="Delgado", days=3, headers=LEAD):
    due = (now() + timedelta(days=days)).isoformat()
    return client.post(url(world), json={"first_name": first, "last_name": last, "due_at": due}, headers=headers)


def test_pledge_checks_off_their_own_chat(client, world):
    b = add(client, world).json()
    rows = client.get(url(world), headers=M1).json()
    assert rows[0]["done"] is False and "done_count" not in rows[0]
    assert client.put(url(world, f"/{b['id']}/done"), headers=M1).status_code == 200
    assert client.put(url(world, f"/{b['id']}/done"), headers=M1).status_code == 200  # idempotent
    assert client.get(url(world), headers=M1).json()[0]["done"] is True
    # Another pledge's list is unaffected.
    assert client.get(url(world), headers=as_user("m2@t.demo")).json()[0]["done"] is False
    lead_row = client.get(url(world), headers=LEAD).json()[0]
    assert (lead_row["done_count"], lead_row["member_count"]) == (1, 3)
    assert client.delete(url(world, f"/{b['id']}/done"), headers=M1).status_code == 200
    assert client.get(url(world), headers=M1).json()[0]["done"] is False


def test_sorted_by_deadline_and_overdue_flag(client, world):
    add(client, world, "Late", "One", days=-1)
    add(client, world, "Later", "Two", days=5)
    rows = client.get(url(world), headers=M1).json()
    assert [r["first_name"] for r in rows] == ["Late", "Later"]
    assert [r["overdue"] for r in rows] == [True, False]


def test_only_leads_manage_brothers_and_only_pledges_check_off(client, world):
    assert add(client, world, headers=M1).status_code == 403
    b = add(client, world).json()
    assert client.delete(url(world, f"/{b['id']}"), headers=M1).status_code == 403
    assert client.put(url(world, f"/{b['id']}/done"), headers=LEAD).status_code == 403
    client.put(url(world, f"/{b['id']}/done"), headers=M1)
    assert client.delete(url(world, f"/{b['id']}"), headers=LEAD).status_code == 204
    assert client.get(url(world), headers=M1).json() == []
    from app.db import SessionLocal
    from app.models import CoffeeChatCompletion
    with SessionLocal() as db:
        assert db.query(CoffeeChatCompletion).count() == 0


def test_rejects_naive_deadline_and_blank_names(client, world):
    naive = (now() + timedelta(days=1)).replace(tzinfo=None).isoformat()
    r = client.post(url(world), json={"first_name": "A", "last_name": "B", "due_at": naive}, headers=LEAD)
    assert r.status_code == 422
    assert add(client, world, first="   ").status_code == 422


def test_other_org_gets_404(client, world):
    b = add(client, world).json()
    out = as_user("outsider@t.demo")
    assert client.get(url(world), headers=out).status_code == 404
    assert add(client, world, headers=out).status_code == 404
    assert client.put(url(world, f"/{b['id']}/done"), headers=out).status_code == 404
    # A brother from org A can't be reached through org B either.
    assert client.delete(url(world, f"/{b['id']}", org="org_b"), headers=out).status_code == 404
    assert client.delete(url(world, f"/{b['id']}/done", org="org_b"), headers=out).status_code == 404


def test_demo_seed_adds_brothers_once(client):
    from app.seed import seed_demo, seed_demo_coffee

    seed_demo()
    assert seed_demo_coffee() == 0
    rows = client.get("/demo/users").json()
    pledge = next(u for u in rows if u["role"] == "member")["email"]
    org = client.get("/me", headers=as_user(pledge)).json()["orgs"][0]["id"]
    chats = client.get(f"/orgs/{org}/coffee-chats", headers=as_user(pledge)).json()
    assert len(chats) == 12 and all(c["first_name"] and c["last_name"] for c in chats)
    assert any(c["done"] for c in chats)
