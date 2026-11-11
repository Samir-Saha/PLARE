# PLARE

PLARE keeps a group's tasks, submissions, and schedules in one place. It was built for a 15-person Kappa Theta Pi pledge class, and the same app works for intern teams, study groups, class project groups, and clubs.

- **Tasks and submissions.** Leads assign tasks with due dates and the proof they need (a note, a photo, or either). Members submit from their dashboard.
- **Task reminders.** Assigned work gets a reminder within 24 hours, within 1 hour, and once overdue. Submitted and approved work is excluded. Reminders show in the app and use existing Web Push/quiet-hour settings when configured.
- **Recurring templates.** Leads can create daily or weekly tasks from **Tasks → New task**, then pause, resume, or end templates. Each occurrence has its own submissions and review history.
- **Review queue.** Every submission lands in one queue with the person, task, time, and photo. Leads approve or send it back with feedback, so nobody digs through a group chat.
- **Phone notifications.** Web Push for every in-app notification, with quiet hours per person and no duplicate sends. Needs VAPID keys (see DEPLOY.md).
- **BP photos taken in the app.** Tasks can require a photo taken with the camera inside PLARE, with no file picker. The server issues a one-time token when the photo is taken and accepts it for 10 minutes, and reviewers see "Taken in the app". This makes cheating harder but can't prove a photo is real: a browser can't rule out a faked camera.
- **AI-writing check.** Written notes and PDF text (export slides as PDF) are scored by a free open-source detector on Hugging Face, and the score appears in the review queue and to the submitter. It never notifies anyone or changes a submission, because detectors misjudge human writing. Set a free `HF_TOKEN` to turn it on. The free models were trained on older AI, so they miss a lot of current AI writing.
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
4. **Deadline back-planner and owner suggestions** (`api/app/engine/planner.py`). Each person's open tasks are scheduled into their free time before each due date, earliest deadline first, in 30 to 120 minute blocks with breaks. Anything that can't fit is flagged with the minutes missing. For open tasks, leads see members ranked by spare time before the deadline (free time minus work already assigned) and can assign in one click.
5. **Submission and review pipeline** (`api/app/routers/tasks.py`). Uploads are checked by file signature and size, stored under server-generated names, and served only to the submitter and that group's leads through an authenticated endpoint.

Authorization is enforced on the server for every route. Roles come from the membership table, never from the client, and a request for another group's data gets a 404.

## Docs

- [Architecture](docs/ARCHITECTURE.md): system diagram, the four technical components, data model, and API routes
- [Demo script](docs/DEMO.md): a 6-minute walkthrough split across the team
- [Deploying](DEPLOY.md): Render (API), Vercel (web), and Supabase (database), step by step

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

The demo group, "KTP Epsilon Class", uses the real pledge class and brothers' names and positions (names and roles only). Every record in it is made up for the presentation, and the app labels it as demo data. The 15 pledges are members; all 12 brothers and NMEs are admins. "Enter as a pledge" signs in as Mohammad Butt, "Enter as a brother / PM" as Abirami, and "Enter as an admin" as Arnav.

To wipe the demo group and its demo users and reseed it (for example after changing `app/seed.py`):

```bash
cd api && python -m app.seed --reset
```

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
cd api && python -m pytest -q     # engines, permissions, uploads, push; also pass on Postgres via TEST_DATABASE_URL
cd web && npx tsc --noEmit && npx eslint src && npm run build
```

## Project layout

```
api/
  app/engine/      availability ranking and study planner (pure functions)
  app/routers/     orgs, tasks, schedule, study
  app/models.py    database schema
  app/auth.py      JWT verification and membership checks
  app/seed.py      demo data (real names, made-up records); --reset reseeds
  tests/
web/
  src/app/         pages: sign-in, tasks, schedule, study, review, group, join
  src/components/  app shell and UI primitives
  src/lib/         API client, Supabase client, formatting
```

## Not built yet

- A notification center page (the API has `GET /notifications`; today they show as push and in-app banners).
- Opt-in alarm mode for important deadlines.
- Cloud file storage. Uploads are saved on the API server's disk, which is fine for a demo and should move to Supabase Storage before real use.
- Deployment config is ready (`render.yaml`, `DEPLOY.md`), but nothing is hosted until someone creates the Render and Vercel accounts.

## Ground rules

PLARE is for coordination and accountability. It doesn't collect location, never turns on a camera by itself, and tells people who can see what they submit.

## Task automation

Open **Tasks** to submit assignments or claim open tasks. Leads/admins also see **New task** and **Recurring templates**. Select Daily or Weekly, choose a future first deadline, and optionally a final deadline. Input dates use your device's timezone, which is saved with the template. Repeats keep the same local time across daylight-saving changes; a time in the spring gap shifts forward through the gap, and a repeated fall time uses the first occurrence.

The first task is created immediately. The minute scheduler creates the next task after the previous deadline, even if earlier work still needs review. After downtime or a pause it skips missed cycles and creates just the next future task. All-members templates use the current member list; selected-user templates exclude people who have left. Ending a template is permanent and does not remove tasks already created.

Deadline reminders are once per assignment/deadline/window. A delayed scheduler sends only the current window, rather than a burst of missed reminders. Submitting work clears its unread reminders. Phone pushes require VAPID keys; quiet hours suppress phone delivery while the reminder remains available in the app. Dismissing a reminder leaves the task unchanged.

Both features use the existing `RUN_REMINDERS=true` loop or authenticated `POST /cron/tick` (see [DEPLOY.md](DEPLOY.md)). Persistence uses new tables only: normal startup `create_all` adds them to an existing SQLite or Postgres database without rewriting task or submission tables. No additional worker service or production dependency is needed.
