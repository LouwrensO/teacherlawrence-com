-- ============================================================
-- THE DAILY LESSON — Supabase schema
-- Paste this whole file into the Supabase SQL Editor and run it.
-- Safe to run more than once (uses IF NOT EXISTS / idempotent policies).
-- ============================================================

-- ---- lessons: one row per lesson, full lesson object in `data` ----
create table if not exists public.lessons (
  id          text primary key,               -- slug, e.g. "the-busy-honey-bees"
  level       text not null,                  -- phonics | beginner | ... | super
  topic       text,                           -- Nature | Science | ...
  type        text not null default 'reading',-- reading | flashcards
  title       text,
  data        jsonb not null,                 -- the full lesson object
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lessons_level_idx on public.lessons (level);
create index if not exists lessons_topic_idx on public.lessons (topic);

-- who created a lesson via "Create Your Own" (null for curated/seeded
-- lessons). Used to rate-limit how many custom lessons one account can
-- generate per day — see api/generate.js.
alter table public.lessons add column if not exists created_by uuid references auth.users(id);
create index if not exists lessons_created_by_idx on public.lessons (created_by, created_at);

-- visibility for "Create Your Own" lessons: 'public' (default — same as
-- every curated lesson, readable by anyone) or 'private' (readable only by
-- created_by — see the RLS policy below). Added so a student can paste in
-- something they don't want to become a publicly-listed lesson (every
-- custom lesson was silently public before this column existed — see the
-- "read own private lessons" policy for the actual enforcement).
alter table public.lessons add column if not exists visibility text not null default 'public';
create index if not exists lessons_visibility_idx on public.lessons (visibility);

-- ---- translations: one row per (lesson, language) ----
-- data holds sentence-aligned translations, e.g.
--   { "paras": [ ["EN sentence","KO sentence"], ... ], "vocab": {...} }
create table if not exists public.translations (
  lesson_id   text not null references public.lessons(id) on delete cascade,
  lang        text not null,                  -- 'ko', 'zh', 'ja', ...
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (lesson_id, lang)
);

-- ---- Row Level Security ----
-- Public may READ lessons + translations. Writes happen only through the
-- service_role key (used server-side in Vercel), which bypasses RLS.
alter table public.lessons      enable row level security;
alter table public.translations enable row level security;

drop policy if exists "public read lessons"      on public.lessons;
drop policy if exists "public read translations" on public.translations;
drop policy if exists "read own private lessons" on public.lessons;

-- Only PUBLIC lessons (the default — every curated lesson, and any custom
-- "Create Your Own" lesson whose creator didn't mark it private) are
-- visible to a plain anon/publishable-key request. api/lessons.js forwards
-- the caller's own JWT when they're logged in (instead of always using the
-- bare publishable key), so the SECOND policy below can also match and a
-- creator can still read their own private lesson.
create policy "public read lessons"
  on public.lessons for select
  to anon, authenticated
  using (visibility = 'public');

create policy "read own private lessons"
  on public.lessons for select
  to authenticated
  using (visibility <> 'public' and created_by = auth.uid());

create policy "public read translations"
  on public.translations for select
  to anon, authenticated
  using (true);

-- ---- profiles: one row per signed-in user; holds subscription status ----
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  subscribed         boolean not null default false,
  stripe_customer_id text,
  current_period_end timestamptz,
  trial_ends_at      timestamptz,
  role               text,   -- 'teacher' | 'student' | 'parent' — remembered per account, not just per browser
  level              text,   -- student's CURRENT active learning-path level — switchable any time from /path (see public/path.html's level switcher); an old placement-test value already here is reused as-is the first time the student loads the locked path
  updated_at         timestamptz not null default now()
);
alter table public.profiles add column if not exists trial_ends_at timestamptz;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists level text;
-- display name — set at signup (adults) or by whoever creates the account
-- (createChild/createClassStudent in api/save-profile.js); this column has
-- been read/written across the app for a while without ever being formally
-- declared here, adding it now for a clean fresh-DB bootstrap.
alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists username text;
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);
-- (writes happen only via the service_role key in the Stripe webhook)

-- a student's class (set when they join a teacher's class by code)
alter table public.profiles add column if not exists class_id uuid;

-- legacy opt-IN preference for the "Bible" lesson topic — no longer read
-- anywhere (see hide_bible_topic below); left in place rather than
-- dropped so no migration has to reason about existing data in it.
alter table public.profiles add column if not exists show_bible_topic boolean not null default false;

-- opt-OUT preference for the "Bible" lesson topic. Bible lessons are
-- visible in Library/Path and free regardless of subscription for every
-- visitor by default (see public/lesson.html's dlDetermineAccess()) — this
-- column only lets a signed-in account explicitly hide the topic for
-- themselves (see public/index.html's toggle / api/access.js).
alter table public.profiles add column if not exists hide_bible_topic boolean not null default false;

-- per-account grant for the Google AI Voice (Gemini Live) test-phase beta —
-- free, no payment needed; independent of subscribed/trial status since
-- eligibility here is "trusted tester", not billing. Toggled from the
-- owner-only /admin-voice page via api/save-profile.js's adminSetLiveVoice
-- action; read by api/speak-chat.js's mode:'live-token' gate alongside the
-- hardcoded LIVE_TEST_ALLOWLIST (kept as a fallback seed list).
alter table public.profiles add column if not exists live_voice_beta boolean not null default false;

-- ============================================================
-- CLASSES + HOMEWORK  (teacher ↔ student)
-- A teacher creates classes; each has a short join code. Students enter
-- the code to join (free). Teachers assign lessons as homework to a class;
-- each activity a student completes is stored as a submission (score/time),
-- so the teacher can see who did their homework and how they scored.
-- All reads/writes go through the service_role key in api/save-profile.js,
-- so these tables have RLS on with no public policies (deny by default).
-- ============================================================
create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  join_code   text unique not null,
  created_at  timestamptz not null default now()
);
create index if not exists classes_teacher_idx on public.classes (teacher_id);

create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  lesson_id   text not null,
  created_at  timestamptz not null default now()
);
create index if not exists assignments_class_idx on public.assignments (class_id);

create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments(id) on delete set null,
  student_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id     text,
  activity      text not null,   -- 'memory'|'scramble'|'match'|'comprehension'|'lesson'|'speaking'
  score         int,
  max           int,
  seconds       int,
  ai_feedback   text,
  created_at    timestamptz not null default now()
);
create index if not exists submissions_student_idx on public.submissions (student_id);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id);

alter table public.classes     enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- Real per-lesson completion state — previously only tracked client-side
-- in localStorage and set to "done" the instant a lesson was OPENED (see
-- git history), which a teacher rightly flagged as meaningless. state is
-- computed server-side in api/save-profile.js from which of the four
-- `steps` keys (read/comprehension/game/talk) are true, so it can't be
-- spoofed by editing localStorage the way the old flag could.
create table if not exists public.lesson_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id  text not null,
  state      text not null default 'in_progress',  -- 'in_progress' | 'done'
  steps      jsonb not null default '{}'::jsonb,    -- {read,comprehension,game,talk: true}
  started_at timestamptz not null default now(),
  done_at    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists lesson_progress_user_idx on public.lesson_progress (user_id, updated_at desc);
alter table public.lesson_progress enable row level security;
-- no policies: all access goes through api/save-profile.js's service_role
-- key, same pattern as classes/assignments/submissions above.

-- ============================================================
-- STUDENT PLAN  (teacher ↔ one student, not a whole class)
-- The teacher's "tonight's lessons" picker: up to 5 lessons a teacher sets
-- as currently active for ONE student (mix of system-suggested and
-- hand-picked). Setting a new plan replaces the previous one. Read via
-- api/save-profile.js (?plan=<studentId> for the teacher, ?myPlan=1 for
-- the student themselves); all writes go through the service_role key,
-- so RLS is on with no public policies (deny by default).
-- ============================================================
create table if not exists public.student_plan (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users(id) on delete cascade,
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  lesson_id   text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists student_plan_student_idx on public.student_plan (student_id);
alter table public.student_plan enable row level security;

-- a class-wide default plan, settable the moment a class is created — before
-- any student has joined. A student who joins and has no personal
-- student_plan of their own inherits this instead (see ?myPlan=1 and
-- ?plan=<studentId> in api/save-profile.js).
create table if not exists public.class_plan (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  lesson_id   text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists class_plan_class_idx on public.class_plan (class_id);
alter table public.class_plan enable row level security;

-- ============================================================
-- LOCKED PATH — per-question pass/fail + attempt tracking
-- Backs the Duolingo-style gate in public/lesson.html: a student can't
-- advance past an item (a comprehension question, a scramble row, ...)
-- until it's passed. attempts/needed_help let the client show the
-- "reveal the answer" fallback after 3 failed tries instead of a
-- permanent wall. Read/write only through api/save-profile.js's
-- service_role key, same deny-by-default RLS pattern as lesson_progress.
-- ============================================================
create table if not exists public.question_attempts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  lesson_id   text not null,
  step_type   text not null,   -- 'comprehension' | 'talk' | 'scramble'
                                -- | 'wordsearch' | 'games' | 'match'
  item_index  int  not null default 0,  -- item's position within its step;
                                         -- 0 for whole-step gates (word
                                         -- search all-found, flashcard match
                                         -- all-paired, any-one-game-round-
                                         -- complete)
  attempts    int  not null default 0,
  passed      boolean not null default false,
  needed_help boolean not null default false,
  last_score  int,             -- 0-10 for AI-graded items, else null
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson_id, step_type, item_index)
);
create index if not exists question_attempts_user_idx
  on public.question_attempts (user_id, lesson_id);
alter table public.question_attempts enable row level security;
-- no policies: all access goes through api/save-profile.js's service_role
-- key, same pattern as lesson_progress/classes/assignments/submissions.
