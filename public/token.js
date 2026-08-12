// token.js — reads the Supabase session token straight out of localStorage
// (no CDN, no client SDK) and asks OUR OWN server whether that user is
// subscribed. Same-origin only, so this is fast and never blocked by a
// slow external library CDN. Include with a plain <script src="token.js">.
const DL_SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const DL_SUPABASE_PUBLISHABLE = "YOUR-NEW-PUBLISHABLE-KEY";

function dlReadToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const parsed = JSON.parse(localStorage.getItem(k));
        if (parsed && parsed.access_token) return parsed.access_token;
      }
    }
  } catch (e) {}
  return null;
}

// The full Supabase login library (public/account.js) auto-refreshes an
// expired access token in the background — but pages that only load this
// lightweight token.js (no CDN/SDK) don't get that for free, and used to
// just accept whatever token happened to be sitting in storage. That meant
// a genuinely logged-in user whose saved session had quietly expired (e.g.
// reopening the site after it sat idle a while) could see the "please log
// in" paywall here while the nav bar (which does use account.js) correctly
// showed them logged in. This does the same refresh account.js's SDK does,
// as one plain fetch to Supabase's own token endpoint — no CDN needed.
async function dlTryRefreshToken() {
  try {
    let refreshToken = null, storageKey = null, existing = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const parsed = JSON.parse(localStorage.getItem(k));
        if (parsed && parsed.refresh_token) { refreshToken = parsed.refresh_token; storageKey = k; existing = parsed; break; }
      }
    }
    if (!refreshToken) return null;
    const rr = await fetch(`${DL_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: DL_SUPABASE_PUBLISHABLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!rr.ok) return null;
    const session = await rr.json();
    if (!session || !session.access_token) return null;
    try { localStorage.setItem(storageKey, JSON.stringify(Object.assign({}, existing, session))); } catch (e) {}
    return session.access_token;
  } catch (e) { return null; }
}

// Two different call sites on lesson.html (the paywall gate and the Live
// Voice tab eligibility check) both want this same result, sometimes
// concurrently — cache the in-flight/most-recent promise rather than firing
// two /api/access requests for one page load.
let _dlAccessPromise = null;
function dlCheckAccess() {
  if (!_dlAccessPromise) _dlAccessPromise = _dlCheckAccessUncached();
  return _dlAccessPromise;
}
async function _dlCheckAccessUncached() {
  let token = dlReadToken();
  if (!token) return { loggedIn: false, subscribed: false, role: null, level: null, liveVoiceBeta: false, token: null };
  try {
    let r = await fetch('/api/access', { headers: { Authorization: 'Bearer ' + token } });
    let j = await r.json();
    if (!j.loggedIn) {
      // the token we had might just be stale, not a real logout — try one
      // silent refresh before concluding the user isn't logged in
      const refreshed = await dlTryRefreshToken();
      if (refreshed) {
        token = refreshed;
        r = await fetch('/api/access', { headers: { Authorization: 'Bearer ' + token } });
        j = await r.json();
      }
    }
    return { loggedIn: !!j.loggedIn, subscribed: !!j.subscribed, trialing: !!j.trialing, trialEndsAt: j.trialEndsAt || null, role: j.role || null, level: j.level || null, hideBibleTopic: !!j.hideBibleTopic, liveVoiceBeta: !!j.liveVoiceBeta, email: j.email || null, token };
  } catch (e) {
    return { loggedIn: true, subscribed: false, trialing: false, trialEndsAt: null, role: null, level: null, hideBibleTopic: false, liveVoiceBeta: false, email: null, token };
  }
}

/* ---- shared "which lessons are free" rules, used by any page that gates
   content beyond lesson.html (which has its own long-standing inline copy
   of this same logic — left as-is to avoid touching a proven gate; new
   pages should call these instead of re-implementing the scheme). ---- */
const DL_LEVEL_ORDER = ["phonics","beginner","elementary","pre-int","intermediate","upper","advanced","super"];
const DL_FULLY_FREE_LEVELS = ["phonics","beginner"];
const DL_FREE_PER_LEVEL = 1; // one sample lesson free at every gated level

function dlFreeLessonIds(list) {
  const freeIds = new Set();
  DL_LEVEL_ORDER.filter(lv => !DL_FULLY_FREE_LEVELS.includes(lv)).forEach(lv => {
    // Bible lessons are free on their own (see dlIsLessonFree below) and
    // don't consume a level's one free-sample slot.
    list.filter(x => x.level === lv && String(x.topic||'').toLowerCase() !== 'bible').slice(0, DL_FREE_PER_LEVEL).forEach(x => freeIds.add(x.id));
  });
  return freeIds;
}

// Is this one lesson viewable without an account/subscription?
function dlIsLessonFree(list, lesson) {
  if (!lesson) return false;
  if (lesson.custom === 'true') return true;
  if (DL_FULLY_FREE_LEVELS.includes(lesson.level)) return true;
  // Bible-topic lessons are a deliberate, permanent free section at every level.
  if (String(lesson.topic||'').toLowerCase() === 'bible') return true;
  return dlFreeLessonIds(list).has(lesson.id);
}

// Shared paywall card markup (same copy/design as lesson.html's gate).
// `loggedIn` picks "already logged in, needs to subscribe" vs
// "not logged in yet, start your trial".
function dlPaywallHtml(loggedIn) {
  const next = encodeURIComponent(location.pathname + location.search);
  return loggedIn
    ? `<div class="paywall"><div class="paywall-card">
        <div class="pw-emoji">🔒</div>
        <h2>${dlT('paywall.title')}</h2>
        <p>${dlT('paywall.body')}</p>
        <a class="pw-btn" href="/subscribe">${dlT('paywall.unlock')}</a>
      </div></div>`
    : `<div class="paywall"><div class="paywall-card">
        <div class="pw-emoji">🔓</div>
        <h2>${dlT('paywall.trialTitle')}</h2>
        <p>${dlT('paywall.trialBody')}</p>
        <a class="pw-btn" href="/login?mode=signup&next=${next}">${dlT('paywall.startTrial')}</a>
      </div></div>`;
}
