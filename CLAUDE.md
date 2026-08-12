# Notes for Claude — Teacher Lawrence (teacherlawrence-com)

## Why this repo exists

Until 2026-08-12, `teacherlawrence.com` was just a second custom domain
bolted onto the `daily-lessons` Vercel project — same codebase, same
Supabase project (`scgmtyrvlkiblqwyzxmm`), as `esllearner.com`. There was
no actual product distinction: `public/render.js` hardcoded
`SITE_NAME = 'ESL Learner'` globally, the kids-login system hardcoded
`kids.esllearner.com`, and every page's branding said "ESL Learner" —
`teacherlawrence.com` visitors were looking at an ESL Learner-branded site
with an ESL Learner database, just under a different URL.

The user (owner of both) asked for this to stop being one shared build and
become two genuinely separate ones — separate codebase, separate Supabase
project, separate Vercel project — so that changes to one product can never
again silently affect the other, and so the `daily-lessons` repo's
`CLAUDE.md` ops history (Vercel Preview/Production domain bugs, Stripe
webhook debugging, etc.) stops being a mess of two products' unrelated
issues tangled together.

This repo (`teacherlawrence-com`) was created as a straight copy of
`daily-lessons`'s `api/`, `public/`, `supabase/`, and `docs/` (excluding
`bible-notes/`, which is a third, unrelated product also living in
`daily-lessons` — see below), with:

- `ESL Learner` → `Teacher Lawrence` (all branding text, page titles, the
  nav brand mark)
- `esllearner.com` / `kids.esllearner.com` → `teacherlawrence.com` /
  `kids.teacherlawrence.com` (site domain + the hidden email domain used
  for child logins)
- The hardcoded shared Supabase project URL and publishable key replaced
  with placeholders (`YOUR-NEW-PROJECT-REF.supabase.co` /
  `YOUR-NEW-PUBLISHABLE-KEY`) — **the new Supabase project didn't exist
  yet at copy time**, so these are not filled in. See `README.md` for the
  exact setup steps.
- The esllearner.com Stripe price ID replaced with a placeholder
  (`YOUR-NEW-STRIPE-PRICE-ID`) — same reasoning, needs its own Stripe
  product.

`OWNER_EMAIL` (`louwrensoberholzer@gmail.com`) was left unchanged — same
person administers both sites, this isn't cross-app entanglement.

**`bible-notes/` was NOT copied here.** It's a third, unrelated product
(a Bible reading journal) that also happens to live inside the
`daily-lessons` repo — same mistake pattern (different product, shared
repo, for speed), but it also shares the *same Supabase project* as the
old combined esllearner/teacherlawrence build, which the `daily-lessons`
`CLAUDE.md` didn't previously call out (it only tracked Vercel/domain
sharing, not the database). If `bible-notes/` needs the same treatment —
its own repo, own Supabase project, own Vercel project — that's a separate
task; don't assume it's already handled.

## Setup status: not yet live

As of 2026-08-12 this repo has code but no live infrastructure of its own:
- No Supabase project created yet (placeholders in code, see above)
- No Vercel project created yet
- No Stripe price created yet
- `teacherlawrence.com` / `www.teacherlawrence.com` DNS still points at
  the old `daily-lessons` Vercel project

See `README.md` → "First-time setup" for the full checklist. Until that's
done, this repo is not deployed anywhere and the old shared build is still
what's actually live at `teacherlawrence.com`.

## Everything else

Once its own Supabase/Vercel/Stripe exist, this app behaves identically to
`esllearner.com` — same features (lesson generation, games, Korean
translation, Practice Speaking, Live Voice beta, child accounts, teacher
classes, Stripe subscription). Treat future bugs/features here the same
way `daily-lessons/CLAUDE.md` treated esllearner.com's — this file is
this repo's equivalent running log, starting fresh from this split rather
than inheriting esllearner.com's history.
