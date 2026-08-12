# Child accounts — one-time setup

The child-accounts feature (a parent manages their kids' logins; each child
logs in with a **username + PIN**, no email) is built and deployed. It needs
**one** manual step before it works, because adding database columns can't be
done from code.

## 1. Run this SQL once (Supabase → SQL Editor → New query → Run)

```sql
alter table profiles add column if not exists username  text;
alter table profiles add column if not exists parent_id uuid;
alter table profiles add column if not exists name      text;

-- one username per child (also enforced by the hidden email, this is belt-and-braces)
create unique index if not exists profiles_username_key on profiles (username);
-- fast "list my children" lookups
create index  if not exists profiles_parent_id_idx on profiles (parent_id);
```

That's it. No redeploy needed — it takes effect immediately.

## 2. How it works (plain English)

- A parent signs up / logs in normally (their real email).
- They open **My family** (link appears in the nav when logged in) and add each
  child: **name, username, PIN, starting level**.
- Behind the scenes each child becomes a normal login whose hidden address is
  `username@kids.teacherlawrence.com`, so **small kids with no email can still log in
  by themselves** — they just type their **username + PIN** on the Log in page.
- Each child keeps their **own level and their own progress**. Siblings sharing
  one phone/tablet don't clash (progress is stored per-user as `dl_done_<id>`).

## 3. What's NOT done yet (waiting on you)

- **Per-student billing (₩10,000 each).** The accounts work and each child gets
  the same 7-day free trial as any new user. Charging **₩10,000 per child on the
  parent's card** is the next step, and it needs the Stripe pieces you're doing
  at your PC:
  1. Confirm Stripe is in **live** mode.
  2. Create a **₩10,000 / month (KRW)** recurring price and send me the price id.
  Then I wire "the parent pays ₩10,000 for each child" on top of this.

## Technical notes

- All the server logic lives in `api/save-profile.js` (no new serverless
  function — we stay under Vercel's 12-function cap):
  - `GET  /api/save-profile?children=1`     → list my children
  - `POST /api/save-profile {createChild}`  → add a child (creates the login)
  - `POST /api/save-profile {setChildPin}`  → reset a child's PIN
  - `POST /api/save-profile {removeChild}`  → delete a child login
- Child auth users are created with the Supabase Admin API using
  `SUPABASE_SECRET_KEY` (already set). Username uniqueness is enforced by the
  hidden email even before the SQL index above is added.
- Login mapping (username → hidden email) is in `public/login.html`; the
  parent UI is `public/family.html`; per-child progress is in `public/path.html`.
