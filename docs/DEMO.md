# PLARE demo script (about 6 minutes)

**Before you start:** open the API's `/health` URL to wake it up, then open the site in two browser windows, one signed in as a pledge and one as a brother / PM.

## 1. The problem (30 seconds)

> "Right now our pledge class runs on a group chat. Good-morning messages, BP photos, study hours, and 'when is everyone free' are all buried in hundreds of messages. Brothers scroll back through the chat to check who did what. PLARE puts all of it in one place."

## 2. A pledge's day (1.5 minutes): **Enter as a pledge**

- **Home:** the progress card shows what's approved, what's pending, and what's overdue.
- **Your plan:** "PLARE scheduled my tasks into my free time before each deadline, earliest deadline first. If something won't fit, it tells me how many minutes I'm short."
- Open a task, add a note or photo, and click **Send for review**. "Only I and the reviewers can see this."

## 3. The brother view (1.5 minutes): **Enter as a brother / PM**

- **Dashboard:** the approvals, review-queue, and on-track cards, then **Most behind**.
- **Review:** "Every submission is in one queue, with who, what, and when." Approve one, then request a revision with feedback. The pledge sees that feedback on the task right away.
- **Dashboard → Open tasks anyone can claim → Suggest owner:** "It ranks people by spare time before the deadline, meaning their free time minus work they already have." Click **Assign**.

## 4. Finding a time (1 minute): **Calendar**

> "Fifteen people, one meeting. PLARE checks everyone's availability in 15-minute steps."

- Point at **Everyone free 15/15**, then an **Alternative 14/15** with the name of who's missing.
- Click **Propose meeting**, and RSVPs come back in the app.

## 5. Study hours with a real calendar (1 minute): **Study hours**

- Start the timer. "It's based on timestamps, so refreshing the page or closing the phone never loses time."
- **The live moment:** sign in with your own Google account, then click **Connect Google Calendar**. "It reads only busy times, never event details, and plans my study blocks around my actual classes."
- **Study together:** the best two-hour windows for the most pledges.

## 6. Why it isn't just "an AI app" (30 seconds)

> "Nothing here is a chatbot. It's real algorithms: interval ranking for availability, earliest-deadline-first scheduling, and a capacity-based owner ranking, all running on real calendar data. There are 36 automated tests, including permission checks so one group can never see another's data."

Close with: "It's built for pledges, but any group with deadlines can use it: intern teams, project groups, clubs."

## Splitting it across the team

| Person | Section |
| --- | --- |
| 1 | Problem + pledge view (1, 2) |
| 2 | Brother view (3) |
| 3 | Scheduling (4) |
| 4 | Study + Google Calendar (5) |
| 5 | Technical close + Q&A (6) |

Each person should be able to explain the component behind their section. `docs/ARCHITECTURE.md` has a one-line method for each.

## If something breaks live

- **The site won't load:** the API is asleep. Wait 30 seconds and refresh, or switch to the localhost version.
- **Google sign-in fails:** skip it. The demo group already has everyone's availability.
- **Keep a backup:** a 1-minute screen recording of sections 2 to 5, ready to play.
