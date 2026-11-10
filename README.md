# PLARE

PLARE keeps a group's tasks, submissions, and schedules in one place. It was built for a 15-person Kappa Theta Pi pledge class, and the same app works for intern teams, study groups, class project groups, and clubs.

- **Tasks and submissions.** Leads assign tasks with due dates and the proof they need (a note, a photo, or either). Members submit from their dashboard.
- **Review queue.** Every submission lands in one queue with the person, task, time, and photo. Leads approve or send it back with feedback, so nobody digs through a group chat.
- **Shared availability.** Everyone marks their weekly free time. PLARE ranks meeting times by how many people can come and names who can't make each alternative.
- **Study hours.** A timer that survives refreshes, a personal study plan built around your Google Calendar, and the best windows for the group to study together.
- **Groups for anyone.** Create a group, pick its type, and invite people with a link. Roles are admin, lead (brother / PM / team lead), and member (pledge / intern / teammate).

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend | FastAPI, SQLAlchemy 2, Pydantic |
| Database | Postgres (Supabase) in production, SQLite locally |
| Auth | Supabase Auth with Google sign-in; JWTs verified by the API |
| Calendar | Google Calendar free/busy API |

## Technical components

1. **Availability engine** (`api/app/engine/availability.py`). The search window is cut into 15-minute steps, and each step gets a bitmask of who is free. A meeting that spans N steps can be attended by the AND of those masks. Consecutive start times with the same attendees merge into one option, and options are ranked by attendance, then flexibility, then how soon they are. Someone who hasn't entered availability is never counted as free.
2. **Study planner** (`api/app/engine/study.py`). Takes one person's free time with calendar busy blocks removed and picks 45 to 120 minute study blocks to hit a weekly goal. It goes round-robin across days so hours spread through the week, caps hours per day, leaves breaks, and reports any shortfall.
3. **Google Calendar import** (`api/app/routers/schedule.py`). Requests the free/busy scope only. The API stores busy start and end times and nothing else: no event titles, no attendees, and the Google token is used once and never saved.
4. **Submission and review pipeline** (`api/app/routers/tasks.py`). Uploads are checked by file signature and size, stored under server-generated names, and served only to the submitter and that group's leads through an authenticated endpoint.

Authorization is enforced on the server for every route. Roles come from the membership table, never from the client, and a request for another group's data gets a 404.

## Run it locally

You need Python 3.11+ and Node 20+.

```bash
# 1. API (http://localhost:8000)
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # DEMO_AUTH=true seeds a demo group on startup
uvicorn app.main:app --reload

# 2. Web (http://localhost:3000), in a second terminal
cd web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and choose **Enter as a pledge**, **Enter as a brother / PM**, or **Enter as an admin**.

### Demo walkthrough

1. Enter as a pledge. The Tasks tab shows what's due, what's in review, and what's approved.
2. Open a task, add a note or photo, and send it for review.
3. Sign out and enter as a brother / PM. The Review tab shows the submission; approve it or request a revision.
4. The same page shows progress for every pledge.
5. Open Schedule to see the ranked meeting times, then propose a meeting.
6. Open Study to start the timer and see the study plan and group study windows.

The demo group has 15 pledges, 2 brothers, and 1 admin. All of them are fictional, and the app labels the group as demo data.

## Google sign-in and Calendar

Demo sign-in works with no setup. For real accounts:

1. Create a Supabase project and enable the Google provider under Authentication.
2. In Google Cloud, create an OAuth client, add Supabase's callback URL, and enable the Google Calendar API. Add the scope `https://www.googleapis.com/auth/calendar.freebusy` to the consent screen. While the app is in testing mode, add each tester's email as a test user.
3. Set `SUPABASE_URL` in `api/.env` (plus `SUPABASE_JWT_SECRET` if the project uses the legacy HS256 secret), and `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env.local`.
4. Point `DATABASE_URL` at the Supabase Postgres connection string, in the form `postgresql+psycopg://...`.
5. Set `DEMO_AUTH=false` in production.

People sign in with Google, then choose **Connect Google Calendar** on the Study tab. That asks for free/busy access only. **Disconnect** deletes the imported busy times.

## Install on your phone

PLARE is a progressive web app. Once it's deployed over HTTPS:

- **iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome and tap **Install app**.

It then opens full-screen from its own icon, like a native app.

## Tests

```bash
cd api && python -m pytest -q     # 28 tests: engines, permissions, uploads, core flows
cd web && npx tsc --noEmit && npx eslint src && npm run build
```

## Project layout

```
api/
  app/engine/      availability ranking and study planner (pure functions)
  app/routers/     orgs, tasks, schedule, study
  app/models.py    database schema
  app/auth.py      JWT verification and membership checks
  app/seed.py      fictional demo data
  tests/
web/
  src/app/         pages: sign-in, tasks, schedule, study, review, group, join
  src/components/  app shell and UI primitives
  src/lib/         API client, Supabase client, formatting
```

## Not built yet

- Reminders and push notifications (good-morning messages, BP posts, deadline alarms). In-app notifications are recorded, but nothing is pushed to a phone yet.
- Recurring tasks, check-in photos during study sessions, and the deadline back-planner.
- Cloud file storage. Uploads are saved on the API server's disk, which is fine for a demo and should move to Supabase Storage before real use.
- Deployment. Nothing is hosted yet.

## Ground rules

PLARE is for coordination and accountability. It doesn't collect location, never turns on a camera by itself, and tells people who can see what they submit.
