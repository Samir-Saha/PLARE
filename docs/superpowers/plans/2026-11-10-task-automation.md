# Task Automation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Leave all changes uncommitted as the user requested.

**Goal:** Deliver automatic task deadline reminders and daily/weekly recurring task templates.

**Architecture:** Pure calendar calculations in an engine; additive persistence models and a database service; existing task routes/components and minute scheduler provide the integration points.

**Tech Stack:** FastAPI, SQLAlchemy, Python zoneinfo, Next.js 16, React 19, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-10-task-automation-design.md`

## Global Constraints

Server-side group authorization; UTC-aware storage; no public evidence; no new production dependencies; semantic design tokens; no agent commits or pushes.

## Review Focus

- Concurrent schedulers must never duplicate notifications or tasks.
- DST, downtime and paused templates must not drift or create an overdue backlog.
- Former group members must not receive assignments or reminders.
- Existing database tables and existing review history must keep working.
- Features must be reachable in the active frontend, including phones.

### Task 1: Reminder windows and recurring dates

Files: `api/app/engine/task_automation.py`, `api/tests/test_task_automation_engine.py`.
Produces: `reminder_stage(due_at, at)` and `next_deadline(first_due_at, after, frequency, timezone)`.
- [ ] Write and run failing tests for each window boundary, daily/weekly local times, DST gaps/folds and long downtime.
- [ ] Implement pure functions and verify tests pass.

### Task 2: Persistent automation, permissions and scheduler

Files: `api/app/models.py`, `api/app/task_automation.py`, `api/app/routers/task_templates.py`, `api/app/routers/tasks.py`, `api/app/main.py`, `api/tests/test_task_automation.py`.
Consumes: Task 1 calendar functions. Produces template CRUD/status API, `generate_recurring_tasks(db, at=None)` and `send_task_reminders(db, at=None)`.
- [ ] Write failing integration tests for creation/validation/permissions, preserved task fields, recurrence/history, current membership, pause/resume/end, duplicate claims, reminders and real cron dispatch.
- [ ] Add separate tables only, implement transactional claim/service/route behavior, and register scheduler passes before push delivery.
- [ ] Verify integration tests and complete backend suite.

### Task 3: Task form, template controls and visible reminders

Files: `web/src/app/app/tasks/page.tsx`, `web/src/components/home/tasks.tsx`, `web/src/components/task-templates.tsx`, `web/src/lib/api.ts`, `web/src/components/shell.tsx`, README/AGENTS/DEPLOY docs.
Consumes: Task 2 template endpoints; existing task APIs and UI.
- [ ] Read bundled Next.js docs, add a Tasks route using existing task/review components, and expose it in navigation.
- [ ] Add daily/weekly options, timezone and end controls to task creation; list templates with pause/resume/end and explicit error/busy/empty states.
- [ ] Show dismissible task reminder banners and route new task links to the Tasks page.
- [ ] Run TypeScript, ESLint, production build and browser smoke checks; document scheduler semantics and deployment.

### Task 4: Review and final verification

- [ ] Review the complete diff for regressions, permission checks, races and existing database compatibility; fix issues with reproducing tests.
- [ ] Run the required full backend and frontend checks; record exact results and any limitations.
- [ ] Provide manual staging, commit and push commands. Do not execute them.
