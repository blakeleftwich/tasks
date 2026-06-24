# Daily Task Board

A simple one-page task tracker. Three columns — **To Do**, **In Progress**, **Done** — with
draggable cards, due dates, priorities, color labels, a history of previous days, a one-click
carry-over of unfinished work, and optional cross-device sync.

**Live:** https://task-manager-phi-nine-59.vercel.app

## Features

- **Today's date** shown at the top; ◀ / ▶ and a date picker to view/edit any day.
- **Three columns**: To Do, In Progress, Done — drag cards between them or use ← / → (touch-friendly).
- **Cards** with a name, notes, **due date** (turns red when overdue), **priority** (low/med/high dot),
  and a **color label** (shown as the card's left edge).
- **Carry over** unfinished tasks from previous days into today with one click.
- **Auto-saved** as you go.
- **Cross-device sync** (optional) via Supabase — sign in with a magic link and your board follows
  you across devices. Without it, everything still works locally in your browser.

## Run locally

Static site — open `index.html`, or serve the folder:

```bash
npx serve .
```

## Enabling cross-device sync (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. **SQL Editor → New query** → paste the contents of [`supabase-schema.sql`](supabase-schema.sql) → **Run**.
3. **Authentication → URL Configuration**: set **Site URL** to your deployed URL and add it under
   **Redirect URLs** (so magic-link emails return to the app).
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into
   [`config.js`](config.js). Both are safe to commit — Row-Level Security restricts every row to its owner.
5. Redeploy. Sign in from the header; existing local tasks migrate up on first sign-in.

## Shared boards (optional)

Each signed-in user gets a private **My Tasks** board, and can create extra boards and
share them with a team:

1. Run [`supabase-boards.sql`](supabase-boards.sql) in the Supabase SQL Editor (once).
   It adds the board tables, the membership rules, and moves your existing tasks into a
   personal board.
2. In the app: use the **board picker** to switch boards, **+ New board** to create one,
   and **🔗 Share** to copy a join link.
3. Send the link to a teammate. When they open it while signed in (magic link), they
   auto-join that board. Everyone on a board sees and edits it, with changes syncing live.

The model stays simple: a board is private until you share its link, membership is what
grants access, and anyone on a board can edit it. Anyone with a board's link can join,
so share links only with people you trust.

## Deploy

```bash
vercel --prod
```

## Tech

Plain HTML, CSS, and JavaScript — no framework, no build step. Optional sync uses the
`@supabase/supabase-js` client loaded from a CDN.

## Data & privacy

Signed out, data lives only in the browser you're using. Signed in, it syncs to your Supabase
project, protected by Row-Level Security so only you can read or write your tasks.
