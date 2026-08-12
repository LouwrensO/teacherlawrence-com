# Teacher Lawrence — standalone build

This is a **separate codebase, separate Supabase project, separate Vercel
project** for `teacherlawrence.com`. It started as a copy of the
`daily-lessons` repo (which now serves only `esllearner.com`) on
2026-08-12, with all esllearner.com-specific branding, domain references,
and shared-database credentials stripped out. From this point on, the two
are independent — changes to one do not affect the other.

See `CLAUDE.md` for the full story of why this split happened and what
still needs setting up.

## First-time setup (do this before the site will work)

The code is here, but three things still point at placeholders and need
real values before anything functions:

### 1. Create a new Supabase project

1. Go to https://supabase.com/dashboard and create a new project (own
   org/billing, separate from the esllearner.com one).
2. Open the SQL Editor, paste the entire contents of `supabase/schema.sql`,
   and run it. Safe to re-run if you're ever unsure.
3. Go to Project Settings → API and copy:
   - **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
   - **`anon` / `publishable` key**
   - **`service_role` / secret key** (keep this one secret — goes in
     Vercel env vars, never in client code)
4. Search this repo for `YOUR-NEW-PROJECT-REF.supabase.co` and
   `YOUR-NEW-PUBLISHABLE-KEY` and replace both with the real values (they're
   hardcoded directly in each `api/*.js` and `public/*.js` file that talks
   to Supabase — that's how the original repo does it too, not a bug).
5. In Supabase → Authentication → URL Configuration, set:
   - Site URL: `https://teacherlawrence.com`
   - Redirect URLs: `https://teacherlawrence.com/reset` and
     `https://teacherlawrence.com/**`

### 2. Create a new Vercel project

1. Import this GitHub repo (`LouwrensO/teacherlawrence-com`) as a new
   Vercel project — do **not** add it as a domain on the existing
   `daily-lessons` Vercel project.
2. Settings → Domains → add `teacherlawrence.com` / `www.teacherlawrence.com`,
   and make sure "Connect to an environment" is set to **Production** (the
   `daily-lessons` project got badly bitten by this defaulting to Preview —
   see `CLAUDE.md`).
3. Settings → Environment Variables, add:
   - `SUPABASE_SECRET_KEY` — the service_role key from step 1
   - `DEEPSEEK_API_KEY` — can reuse the same DeepSeek account as
     esllearner.com, or get a separate one if you want separate billing
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — from a Stripe
     product/price you create for this site (see step 3)
   - `SEED_TOKEN` — any random string, used to protect admin bulk-tool
     routes
   - Optional, only if you use these features: `UNSPLASH_ACCESS_KEY`,
     `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
4. Once the domain is confirmed serving Production, remove
   `teacherlawrence.com` / `www.teacherlawrence.com` from the old
   `daily-lessons` Vercel project so there's no double-binding.

### 3. Create a new Stripe price (if you use the $/month subscription)

1. In Stripe, create a new Product + Price for this site (own price ID,
   even if same $ amount as esllearner.com — keeps billing/reporting
   separate).
2. In `api/checkout.js`, replace `YOUR-NEW-STRIPE-PRICE-ID` with the real
   price ID.
3. Point the Stripe webhook at `https://teacherlawrence.com/api/stripe-webhook`
   and put its signing secret in `STRIPE_WEBHOOK_SECRET` (step 2 above).

Everything else (lesson generation, games, translations, admin tools) works
exactly like esllearner.com once the above three are done — it's the same
app, just talking to its own database and billing account.
