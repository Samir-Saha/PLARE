# PLARE: instructions for coding agents

PLARE is a shared app for groups: tasks, photo/text submissions with a review queue, shared availability, and study hours. It was built for a 15-person KTP pledge class and works for any group (intern teams, study groups, clubs). Read `README.md` first.

## Layout

- `api/`: FastAPI + SQLAlchemy 2. Engines in `app/engine/` are pure functions with no database access. Routes are in `app/routers/`.
- `web/`: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4. Next.js 16 has breaking changes, so read `web/AGENTS.md` and the docs in `web/node_modules/next/dist/docs/` before writing frontend code.

## Rules

- **Authorization is server-side.** Every org-scoped route calls `membership(db, user, org_id, ...)` from `app/auth.py`. Never trust a role, user id, or timestamp sent by the client. Data from another group returns 404.
- **Times are UTC and timezone-aware.** Use the `UTCDateTime` column type and reject naive datetimes. Convert to a person's timezone only for display or for "local day" rules.
- **Use only real data.** Never fake an integration when credentials are missing; show a clear "not configured" state instead. Seed data lives only in `app/seed.py` and is flagged `is_demo`.
- **Keep files private.** Uploads are validated by file signature and size and served only through authenticated endpoints. Never return a public URL for evidence.
- **Stay within accountability, not surveillance.** Never turn a camera on automatically, never collect location, and never build hazing workflows (punishment, sleep deprivation, alcohol). Alarms must always be dismissible by the user.
- **Use design tokens.** Use the semantic color names from `web/src/app/globals.css` (`bg-surface`, `text-muted`, `bg-accent`, and so on), never raw hex values. Both light and dark themes must keep working.
- **Write user-facing text plainly.** Use short, specific sentences, and make error messages say what to do next.

## Before every commit

```bash
cd api && python -m pytest -q
cd web && npx tsc --noEmit && npx eslint src && npm run build
```

All of these must pass. Add tests for new backend behavior, especially permissions. Commit one feature at a time with a clear message, and never commit `.env`, `.env.local`, `*.db`, or `uploads/`.

## Not built yet, in priority order

1. **Deployment:** the config is done (`render.yaml`, `DEPLOY.md`). What's left is creating the Render and Vercel accounts, which the repo owner has to do.
2. **Notifications page:** the API already has `GET /notifications` and `POST /notifications/read`. Build the in-app notification center with unread counts and read/unread states.
3. **Reminders and web push:** a scheduled job in the API (APScheduler or a cron endpoint) sends recurring reminders (good-morning message, BP posts, due-soon, overdue) via Web Push (VAPID keys, a service worker, and stored subscriptions). Respect each user's quiet hours and avoid sending duplicates.
4. **Recurring tasks:** a recurrence rule on a task that creates the next assignment on a schedule.
5. **Optional study check-in photos:** during a running study session, prompt at a group-configured interval. Camera use always requires the user to press a button.
6. **Alarm mode (opt-in):** for an important deadline, repeat push reminders until the user solves a simple addition problem in the app or dismisses the alarm. The answer is checked on the server.

Done: the deadline back-planner and owner suggestions (`app/engine/planner.py`, `app/routers/planner.py`, `web/src/components/plan.tsx`).
