# Task deadline reminders and recurring templates

The user selected both proposed features and requested implementation, testing, and manual commit instructions. All work stays local and uncommitted.

## Behavior

- Existing assigned tasks receive one reminder in the 24-hour window, one in the final hour, and one after the deadline. Only the currently applicable window fires; missed windows never arrive together. Submitted/approved, deleted, undated tasks and former members are excluded.
- Reminders use `auth.notify` and the existing Web Push sender, including its quiet-hour behavior. An in-app dismissible task reminder banner makes reminders usable without push credentials.
- Leads/admins create daily or weekly templates from the task form. The first task is created immediately with a future first deadline. Later tasks appear after the previous deadline. Each occurrence is an ordinary Task with separate assignments/submissions/reviews.
- Templates preserve the deadline's local wall time in an IANA timezone. Nonexistent spring-forward times move forward through the gap; ambiguous fall-back times use the first occurrence. Missed cycles are skipped after downtime or pause, creating only the next future task.
- Templates support all current assignment modes (all current members, open claim, selected current users). Removed users are never assigned. Leads can pause, resume, or permanently end a template; existing tasks and evidence remain untouched. An optional inclusive final deadline stops future creation.

## Approach and constraints

Extend the existing minute loop and `/cron/tick`, rather than introducing another job service. Keep pure time calculations in `app/engine/` and database work in a small task automation service; expose template routes alongside tasks. Use additive tables for templates, selected assignees, occurrence claims and reminder claims, so startup `create_all` upgrades an existing database without altering existing task columns. Unique database constraints and transactions prevent duplicate occurrences/reminders across scheduler runners. Authorization remains server-side and group-scoped.

A Tasks page exposes the existing task components because the current `/app` route renders Events and the older task dashboards are not routed. Preserve Events and add a navigation entry. Reuse semantic tokens, API helpers, private upload/review flows, and the existing scheduler configuration. No new production dependencies or external integrations.

Alternatives considered: an external queue adds deployment requirements; resetting the same assignment each cycle loses submission history. Both are unnecessary for this group's scale.

## Validation

Test timing boundaries, skipped cycles, DST, deduplication, authorization, removed members, pause/end/resume, ordinary review history, cron integration, and quiet hours. Run the complete backend suite, TypeScript, ESLint and production build, plus a browser smoke test. Leave commits and pushes to the user.
