"""Demo data. Real names, but every record here is made up for the presentation.

Only names and roles are real: no phone numbers, real emails, or other personal details.
Every user and the group are flagged is_demo, and emails are generated as <name>@plare.demo.

Other seeds (BP, GM, points, study, log) should look people up by name or role with
`demo_people()` / `demo_org()`, never by list position.

    python -m app.seed           # create the demo group if it doesn't exist
    python -m app.seed --reset   # delete the demo group and its demo users, then reseed
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .db import Base, SessionLocal, engine, now
from .engine import gm as gm_rules
from .models import (Assignment, AvailabilityRule, GmCode, GmMessage, GmSettings, LogEntry, MemberTitle, Membership,
                     Notification, Organization, Role, StudySession, Submission, Task, TaskStatus, User)

GM_GOALS = ["Finish the capstone wireframes.", "Two hours on the data structures problem set.",
            "Coffee chat with a brother before lunch.", "Gym at 7, then study for the stats midterm.",
            "Draft my BP post caption.", "Get through chapter 6 and make flashcards."]

ORG_NAME = "KTP Epsilon Class"

# Pledges (role: member), as display names.
PLEDGES = [
    "Mohammad Butt", "Samir Saha", "Ryan Purakal", "Riana Sherali", "Anima Shrivastava", "Matt Pinto",
    "Aarushi Arora", "Kavya Barathy", "Kishor GS", "Darsh Srivastava", "Ayushi Jha", "Anushri Vijayakumar",
    "Raghav Mehta", "Shraaptesh Lokanda", "Aashwika Gupta",
]

# Brothers and NMEs (role: admin), with the position shown under their name.
BROTHERS = [
    ("Arnav", "NME"),
    ("Abirami", "NME"),
    ("Aditi Sreeganesh", "President"),
    ("Krish Bansal", "Vice President"),
    ("Abhiram Sajjala", "VP of Engagement"),
    ("Aditya Velagapudi", "VP of Internal Affairs"),
    ("Krish Maske", "VP of Technology"),
    ("Krisha Bhagat", "VP of Marketing"),
    ("Gokulraj Kumarassamy", "VP of Membership"),
    ("Aaron Bansal", "VP of Professional Development"),
    ("Gourika Dhiman", "VP of External Affairs"),
    ("Gravit Bali", "VP of Finance"),
]

# Who the sign-in page's three demo buttons enter as (matched by name on the web side too).
DEMO_LOGINS = {"pledge": "Mohammad Butt", "brother": "Abirami", "admin": "Arnav"}

ET = ZoneInfo("America/New_York")


def _email(name: str) -> str:
    return name.lower().replace(" ", ".") + "@plare.demo"


def demo_org(db: Session) -> Organization | None:
    return db.scalar(select(Organization).where(Organization.is_demo.is_(True)))


def demo_people(db: Session, org_id: str, role: Role | None = None) -> dict[str, User]:
    """Demo group members by display name, optionally filtered by role."""
    q = select(User, Membership.role).join(Membership, Membership.user_id == User.id).where(Membership.org_id == org_id)
    return {u.name: u for u, r in db.execute(q) if role is None or Role(r) == role}


def seed_demo() -> bool:
    """Create the demo group once, then make sure its log is seeded. Returns False if the group already existed."""
    created = _seed_core()
    seed_demo_log()
    return created


def _seed_core() -> bool:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if demo_org(db):
            return False
        org = Organization(name=ORG_NAME, kind="pledge_class", is_demo=True)
        db.add(org)
        db.flush()

        def person(name: str, role: Role, title: str | None = None) -> User:
            u = User(email=_email(name), name=name, is_demo=True)
            db.add(u)
            db.flush()
            db.add(Membership(org_id=org.id, user_id=u.id, role=role))
            if title:
                db.add(MemberTitle(org_id=org.id, user_id=u.id, title=title))
            return u

        brothers = [person(n, Role.admin, t) for n, t in BROTHERS]
        pledges = [person(n, Role.member) for n in PLEDGES]
        by_name = {u.name: u for u in brothers}
        task_owner, approver, reviser, code_setter = by_name["Abirami"], by_name["Abirami"], by_name["Arnav"], by_name["Arnav"]

        # Weekly availability. Everyone shares Tuesday 7:00-9:00 PM; the rest varies per person.
        for i, u in enumerate(pledges + brothers):
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
        # Due dates land on real Eastern clock times (11:59 AM, 9:00 PM, ...), not "now plus N days".
        specs = [
            ("BP post: week 6", "BP Posts", "Post this week's brother-pledge photo.", _on(2, 11, 59), "photo", "normal"),
            ("Log 10 study hours", "Study Hours", "Hit 10 tracked study hours this week.", _on(5, 23, 59), "none", "normal"),
            ("Capstone checkpoint write-up", "General Requirements", "One paragraph on what you built this week.", _on(3, 21, 0), "any", "normal"),
        ]
        # The (i + n) % 5 rotation gives each pledge at most one revision request, spread across the class.
        for n, (title, cat, desc, due, evidence, prio) in enumerate(specs):
            task = Task(org_id=org.id, title=title, category=cat, description=desc, due_at=due, evidence=evidence,
                        priority=prio, created_by=task_owner.id, estimate_minutes=30)
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
                                 text="Demo submission for the presentation.", created_at=t - timedelta(hours=3 + i))
                db.add(sub)
                if k == 0:
                    sub.status, sub.reviewer_id, sub.reviewed_at = "approved", approver.id, t - timedelta(hours=1)
                    a.status, a.completed_at = TaskStatus.approved, sub.reviewed_at
                elif k == 1:
                    a.status = TaskStatus.submitted
                else:
                    sub.status, sub.feedback = "needs_revision", "Add a bit more detail and resubmit."
                    sub.reviewer_id, sub.reviewed_at = reviser.id, t - timedelta(hours=2)
                    a.status = TaskStatus.needs_revision
        # One past-due task. Only two pledges missed it (those with the fewest other issues, ties by
        # name); everyone else submitted before the 9:00 PM deadline.
        interview_due = _on(-1, 21, 0)
        interview = Task(org_id=org.id, title="Interview a brother", category="General Requirements",
                         description="Coffee chat notes with one active brother.", due_at=interview_due, evidence="text",
                         priority="low", created_by=task_owner.id, estimate_minutes=30)
        db.add(interview)
        db.flush()
        revisions = {u.id: 0 for u in pledges}
        for a in db.scalars(select(Assignment).where(Assignment.org_id == org.id, Assignment.status == TaskStatus.needs_revision.value)):
            revisions[a.user_id] += 1
        missed = {u.id for u in sorted(pledges, key=lambda u: (revisions[u.id], u.name))[:2]}
        for i, u in enumerate(sorted(pledges, key=lambda u: u.name)):
            a = Assignment(task_id=interview.id, org_id=org.id, user_id=u.id)
            db.add(a)
            db.flush()
            if u.id in missed:
                continue
            sent_at = interview_due - timedelta(hours=2 + i % 20, minutes=7 * i % 60)
            sub = Submission(assignment_id=a.id, org_id=org.id, user_id=u.id,
                             text="Demo submission for the presentation.", created_at=sent_at)
            db.add(sub)
            if i % 2 == 0:
                sub.status, sub.reviewer_id, sub.reviewed_at = "approved", approver.id, interview_due + timedelta(hours=1)
                a.status, a.completed_at = TaskStatus.approved, sub.reviewed_at
            else:
                a.status = TaskStatus.submitted

        db.add(Task(org_id=org.id, title="Book a room for game night", category="Events", claimable=True,
                    description="Open task: first to claim it owns it.", due_at=_on(4, 21, 0),
                    created_by=task_owner.id, estimate_minutes=20))

        # GM messages: due 6:00 AM New York time. Today's code word is "lantern"; pledges can send today's.
        # k = (i + 3 * back) % 7 puts each pledge's two past days 3 apart in the cycle, so nobody gets
        # more than one late (k=4), wrong-code (k=5) or missing (k=6) GM across the seeded days.
        tz = "America/New_York"
        db.add(GmSettings(org_id=org.id, enabled=True, due_minute=gm_rules.DEFAULT_DUE_MINUTE,
                          reminder_minutes=gm_rules.DEFAULT_REMINDER_MINUTES, timezone=tz))
        today = gm_rules.local_day(t, tz)
        for back, code in ((0, "lantern"), (1, "compass"), (2, "harbor")):
            day = today - timedelta(days=back)
            db.add(GmCode(org_id=org.id, day=day.isoformat(), code=code, set_by=code_setter.id))
            if back == 0:
                continue
            due = gm_rules.due_at(day, gm_rules.DEFAULT_DUE_MINUTE, tz)
            for i, u in enumerate(pledges):
                k = (i + 3 * back) % 7
                if k == 6:
                    continue  # missing
                sent = due + timedelta(minutes=12 + i) if k == 4 else due - timedelta(minutes=40 - 2 * i)
                given = "compas" if back == 1 and k == 5 else "lighthouse" if k == 5 else code.capitalize() if k == 2 else code
                db.add(GmMessage(org_id=org.id, user_id=u.id, day=day.isoformat(), goal=GM_GOALS[(i + back) % len(GM_GOALS)],
                                 code_given=given, due_at=due, submitted_at=sent))

        for i, u in enumerate(pledges):
            for d in range(1, 4):
                start = t - timedelta(days=d, hours=2 + i % 3)
                db.add(StudySession(org_id=org.id, user_id=u.id, started_at=start,
                                    ended_at=start + timedelta(minutes=50 + 10 * ((i + d) % 6))))
        db.commit()
        return True


# --- Accountability log demo entries -------------------------------------------------------

# (kind, detail, days ago, hour, minute, manual). Details are mild and never name anyone.
# The two overdue_task entries come from the automatic overdue sync, dated at the 9:00 PM deadline.
# GM messages are due 6:00 AM and BP posts 11:59 AM, matching those features' real deadlines.
LOG_SPECS = [
    ("late_gm", "GM message sent 6:14 AM (due 6:00 AM).", 6, 6, 14, False),
    ("wrong_code", "GM message used the previous day's code word.", 5, 5, 52, False),
    ("other", "Arrived a few minutes late to the pledge meeting.", 5, 19, 40, True),
    ("late_bp", "BP post went up 12:07 PM (due 11:59 AM).", 4, 12, 7, False),
    ("study_short", "9h 10m logged last week, short of the 10-hour goal.", 3, 0, 5, False),
    ("other", "Left study session early.", 3, 20, 15, True),
    ("late_bp", "BP post went up 12:22 PM (due 11:59 AM).", 2, 12, 22, False),
    ("other", "Forgot to RSVP for chapter.", 2, 21, 5, True),
    ("wrong_code", "GM message code word was misspelled.", 1, 5, 47, False),
    ("late_gm", "GM message sent 6:09 AM (due 6:00 AM).", 0, 6, 9, False),
]
MAX_LOG_PER_PLEDGE = 2


def _on(days_ahead: int, hh: int, mm: int) -> datetime:
    """A real Eastern clock time N days from today (negative for the past)."""
    day = now().astimezone(ET).date() + timedelta(days=days_ahead)
    return datetime.combine(day, time(hh, mm), tzinfo=ET)


def _at(days_ago: int, hh: int, mm: int) -> datetime:
    """A past Eastern clock time; if 'today at hh:mm' hasn't happened yet, use the day before."""
    at = _on(-days_ago, hh, mm)
    return at if at <= now() else at - timedelta(days=1)


def seed_demo_log() -> int:
    """Seed the demo log once, spread so no pledge ends up with more than two entries in total.

    Counts each pledge's existing negatives first: overdue assignments (which the log's
    automatic overdue sync will add) and revision requests. Each seeded entry then goes to
    the pledge with the fewest log entries so far, breaking ties by fewest negatives.
    """
    from .logbook import add_entry

    with SessionLocal() as db:
        org = demo_org(db)
        if org is None or db.scalar(select(LogEntry.id).where(LogEntry.org_id == org.id).limit(1)):
            return 0
        pledges = demo_people(db, org.id, Role.member)
        author = demo_people(db, org.id, Role.admin).get("Abirami")

        assignments = db.scalars(select(Assignment).join(Task).where(Assignment.org_id == org.id, Task.deleted_at.is_(None))).all()
        overdue = {u.id: 0 for u in pledges.values()}
        negatives = dict(overdue)
        for a in assignments:
            if a.user_id not in overdue:
                continue
            late = a.task.due_at is not None and a.task.due_at < now() and a.status not in (TaskStatus.submitted, TaskStatus.approved)
            overdue[a.user_id] += int(late)
            negatives[a.user_id] += int(late) + int(a.status == TaskStatus.needs_revision)
        # Late, wrong-code and missing GMs count toward the tie-break too.
        gm_days = {m.day for m in db.scalars(select(GmMessage).where(GmMessage.org_id == org.id))}
        sent = {(m.user_id, m.day): m for m in db.scalars(select(GmMessage).where(GmMessage.org_id == org.id))}
        codes = {c.day: c.code for c in db.scalars(select(GmCode).where(GmCode.org_id == org.id))}
        for uid_ in negatives:
            for day in gm_days:
                m = sent.get((uid_, day))
                negatives[uid_] += 1 if m is None else int(bool(gm_rules.flags(m.submitted_at, m.due_at, m.code_given, codes.get(day))))
        log_count = dict(overdue)  # projected: the overdue sync logs each of these once

        added = []
        names = sorted(pledges)  # stable tie-break by name, never by list position
        for kind, detail, days, hh, mm, manual in LOG_SPECS:
            pick = min((n for n in names if log_count[pledges[n].id] < MAX_LOG_PER_PLEDGE),
                       key=lambda n: (log_count[pledges[n].id], negatives[pledges[n].id], n), default=None)
            if pick is None:
                break
            uid_ = pledges[pick].id
            entry = add_entry(db, org.id, uid_, kind, detail, created_by=author.id if manual and author else None,
                              source_key=None if manual else f"demo:{kind}:{days}:{hh}{mm}")
            entry.created_at = _at(days, hh, mm)
            log_count[uid_] += 1
            negatives[uid_] += 1
            added.append((uid_, detail, entry.created_at))
        db.flush()
        # Backdate the matching notifications so the demo inbox reads naturally.
        for n in db.scalars(select(Notification).where(Notification.org_id == org.id, Notification.category == "log")):
            when = next((at for uid_, detail, at in added if uid_ == n.user_id and detail == n.body), None)
            if when:
                n.created_at = when
        db.commit()
        return len(added)


# --- Reset ------------------------------------------------------------------------------------

def reset_demo() -> None:
    """Delete the demo group, its records, and the is_demo users, in every table (including teammates')."""
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        org_ids = list(db.scalars(select(Organization.id).where(Organization.is_demo.is_(True))))
        user_ids = list(db.scalars(select(User.id).where(User.is_demo.is_(True))))
        for table in reversed(Base.metadata.sorted_tables):  # children before parents
            conds = []
            if org_ids and "org_id" in table.c:
                conds.append(table.c.org_id.in_(org_ids))
            if user_ids:
                conds += [c.in_(user_ids) for c in table.c if any(fk.column.table.name == "users" for fk in c.foreign_keys)]
            if table.name == "organizations" and org_ids:
                conds.append(table.c.id.in_(org_ids))
            if table.name == "users" and user_ids:
                conds.append(table.c.id.in_(user_ids))
            if conds:
                db.execute(table.delete().where(or_(*conds)))
        db.commit()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Seed the PLARE demo group.")
    parser.add_argument("--reset", action="store_true", help="delete the demo group and demo users first, then reseed")
    args = parser.parse_args()
    if args.reset:
        reset_demo()
        print("Deleted the demo group and demo users.")
    print("Seeded demo group." if seed_demo() else "Demo group already exists.")
