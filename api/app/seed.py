"""Demo data. Every person here is fictional and every record is flagged is_demo."""
from datetime import timedelta

from sqlalchemy import select

from .db import Base, SessionLocal, engine, now
from .models import (Assignment, AvailabilityRule, Membership, Organization, Role, StudySession, Submission,
                     Task, TaskStatus, User)

PLEDGES = ["Avery Lin", "Blake Osei", "Camila Reyes", "Devon Park", "Elena Novak", "Farid Haddad", "Grace Kim",
           "Hugo Martins", "Imani Cole", "Jonah Weiss", "Kira Tanaka", "Leo Fontaine", "Mina Shah", "Noah Brandt",
           "Priya Nair"]
LEADS = ["Rowan Ellis", "Sasha Petrov"]
ADMIN = "Taylor Quinn"


def _email(name: str) -> str:
    return name.lower().replace(" ", ".") + "@plare.demo"


def seed_demo() -> bool:
    """Create the demo group once. Returns False if it already exists."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(Organization).where(Organization.is_demo.is_(True))):
            return False
        org = Organization(name="KTP Epsilon Class (Demo)", kind="pledge_class", is_demo=True)
        db.add(org)
        db.flush()

        def person(name: str, role: Role) -> User:
            u = User(email=_email(name), name=name, is_demo=True)
            db.add(u)
            db.flush()
            db.add(Membership(org_id=org.id, user_id=u.id, role=role))
            return u

        admin = person(ADMIN, Role.admin)
        leads = [person(n, Role.lead) for n in LEADS]
        pledges = [person(n, Role.member) for n in PLEDGES]

        # Weekly availability. Everyone shares Tuesday 7:00-9:00 PM; the rest varies per person.
        for i, u in enumerate(pledges + leads + [admin]):
            rules = [(1, 19 * 60, 21 * 60)]
            for day in range(7):
                if (i + day) % 3 == 0:
                    rules.append((day, (9 + i % 4) * 60, (12 + i % 4) * 60))
                if (i * 2 + day) % 4 != 0:
                    rules.append((day, (15 + i % 3) * 60, (18 + (i + day) % 4) * 60))
                if (i + day) % 5 != 0 and day != 1:
                    rules.append((day, 19 * 60 + 30 * (i % 2), 22 * 60))
            db.add_all(AvailabilityRule(user_id=u.id, weekday=d, start_minute=s, end_minute=e) for d, s, e in rules)

        t = now()
        specs = [
            ("Good morning message", "Good Morning Messages", "Send your good morning message to your assigned brother.", t + timedelta(hours=14), "text", "high"),
            ("BP post: week 6", "BP Posts", "Post this week's brother-pledge photo.", t + timedelta(days=2), "photo", "normal"),
            ("Log 10 study hours", "Study Hours", "Hit 10 tracked study hours this week.", t + timedelta(days=5), "none", "normal"),
            ("Capstone checkpoint write-up", "General Requirements", "One paragraph on what you built this week.", t + timedelta(days=3), "any", "normal"),
            ("Interview a brother", "General Requirements", "Coffee chat notes with one active brother.", t - timedelta(days=1), "text", "low"),
        ]
        for n, (title, cat, desc, due, evidence, prio) in enumerate(specs):
            task = Task(org_id=org.id, title=title, category=cat, description=desc, due_at=due, evidence=evidence,
                        priority=prio, created_by=leads[0].id, estimate_minutes=30)
            db.add(task)
            db.flush()
            for i, u in enumerate(pledges):
                a = Assignment(task_id=task.id, org_id=org.id, user_id=u.id)
                db.add(a)
                db.flush()
                k = (i + n) % 5
                if evidence == "none" or k >= 3:
                    continue
                sub = Submission(assignment_id=a.id, org_id=org.id, user_id=u.id,
                                 text=f"Demo submission from {u.name}.", created_at=t - timedelta(hours=3 + i))
                db.add(sub)
                if k == 0:
                    sub.status, sub.reviewer_id, sub.reviewed_at = "approved", leads[0].id, t - timedelta(hours=1)
                    a.status, a.completed_at = TaskStatus.approved, sub.reviewed_at
                elif k == 1:
                    a.status = TaskStatus.submitted
                else:
                    sub.status, sub.feedback = "needs_revision", "Add a bit more detail and resubmit."
                    sub.reviewer_id, sub.reviewed_at = leads[1].id, t - timedelta(hours=2)
                    a.status = TaskStatus.needs_revision
        db.add(Task(org_id=org.id, title="Book a room for game night", category="Events", claimable=True,
                    description="Open task: first to claim it owns it.", due_at=t + timedelta(days=4),
                    created_by=leads[0].id, estimate_minutes=20))

        for i, u in enumerate(pledges):
            for d in range(1, 4):
                start = t - timedelta(days=d, hours=2 + i % 3)
                db.add(StudySession(org_id=org.id, user_id=u.id, started_at=start,
                                    ended_at=start + timedelta(minutes=50 + 10 * ((i + d) % 6))))
        db.commit()
        return True


if __name__ == "__main__":
    print("Seeded demo group." if seed_demo() else "Demo group already exists.")
