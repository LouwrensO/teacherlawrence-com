// account.js — shared login state. Include on any page with:
//   <span id="accountNav"></span>            (where the nav link should appear)
//   <script type="module" src="account.js"></script>
// Uses Supabase Auth. The publishable key is safe to ship.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const SUPABASE_KEY = "YOUR-NEW-PUBLISHABLE-KEY";
const OWNER_EMAIL = "louwrensoberholzer@gmail.com";  // sees the Admin link

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabase = supabase;               // let inline scripts use it too

// Fast path: if a recovery link lands on some other page with the token
// still in the URL hash, bounce to /reset immediately (keeping the hash)
// so the reset page is the one that consumes it. The onAuthStateChange
// handler below is the catch-all for flows that don't use a hash.
try {
  const h = location.hash || "";
  if (h.includes("type=recovery") &&
      !location.pathname.replace(/\/$/, "").endsWith("/reset")) {
    location.replace("/reset" + h);
  }
} catch (e) {}

async function logOut(e) {
  if (e) e.preventDefault();
  try { await supabase.auth.signOut(); } catch (_) {}
  localStorage.removeItem("dl_role");
  localStorage.removeItem("dl_level");
  localStorage.removeItem("dl_uid");   // back to guest; each user's dl_done_<uid> stays put
  // Role/level are remembered on the ACCOUNT now (not just this
  // browser), so logging out should just go home — logging back in via
  // /login will recognize the account and skip onboarding again.
  location.href = "/";
}
window.dlLogOut = logOut;

/* "My homework" starts hidden (see renderAccount()) since it's only
   meaningful for a student a teacher actually assigns things to — reveal
   it here once /api/access confirms classStudent (the same class_id
   check the paywall gate already uses), then layer the same small red
   count badge on top, reusing /api/save-profile?homework=1 data
   public/homework.html already fetches (no submissions yet = "to do").
   Runs on every page for a logged-in student, since the nav (and this
   badge) render on every page. */
async function fetchHomeworkBadge() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session && session.access_token;
    if (!token) return;
    const ar = await fetch('/api/access', { headers: { Authorization: 'Bearer ' + token } });
    const aj = ar.ok ? await ar.json() : null;
    if (!aj || !aj.classStudent) return;   // no teacher/class: nothing to show
    const link = document.getElementById('myHomeworkLink');
    if (link) link.style.display = '';
    const r = await fetch('/api/save-profile?homework=1', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const j = await r.json();
    const assignments = (j && j.assignments) || [];
    const todo = assignments.filter((a) => !a.submissions || !a.submissions.length).length;
    const badge = document.getElementById('hwBadge');
    if (!badge) return;
    if (todo > 0) { badge.textContent = String(todo); badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  } catch (e) {}
}

async function renderAccount() {
  const el = document.getElementById("accountNav");
  if (!el) return;
  const { data: { user } } = await supabase.auth.getUser();
  const role = localStorage.getItem("dl_role");
  if (user || role) {
    const t = (typeof window.dlT === 'function') ? window.dlT : (k) => k;
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    // prefer the name the parent gave a child (in user metadata); fall back
    // to the email/username local-part. Show it with a capital first letter.
    const dispName = user ? ((user.user_metadata && user.user_metadata.name) || (user.email || "Account").split("@")[0]) : "";
    const label = user ? "👤 " + cap(dispName)
                       : (role === "teacher" ? "👩‍🏫 " + t('nav.teacher')
                          : role === "parent" ? "👪 " + t('nav.parent')
                          : "🧑‍🎓 " + t('nav.student'));
    const isOwner = user && (user.email || "").toLowerCase() === OWNER_EMAIL;
    // children log in with a hidden username@kids.teacherlawrence.com address;
    // they don't manage a family, so only show "My family" to real accounts.
    const isChild = user && /@kids\.teacherlawrence\.com$/i.test(user.email || "");
    if (user) { try { localStorage.setItem("dl_uid", user.id); } catch (_) {} }
    const isTeacher = role === "teacher";
    const isStudent = role === "student";
    // "My homework" only means anything for a student actually in a class
    // (a teacher assigns it) — an independent student with no teacher has
    // nothing that could ever show up there, so it starts hidden and is
    // only revealed below once classStudent comes back true (see
    // fetchHomeworkBadge()/classStudent check further down). "My family"
    // is a parent/guardian feature (adding child logins) that never
    // applied to a student's own account, class or not.
    el.innerHTML =
      `<span class="nav-link" style="cursor:default">${label}</span>` +
      (isTeacher ? `<a class="nav-link" href="/teacher">${t('nav.myClasses')}</a>` : ``) +
      (isStudent ? `<a class="nav-link" href="/homework" id="myHomeworkLink" style="display:none;">${t('nav.myHomework')}<span class="nav-badge" id="hwBadge" style="display:none;"></span></a>` : ``) +
      (user && !isChild && !isStudent ? `<a class="nav-link" href="/family">${t('nav.family')}</a>` : ``) +
      (isOwner ? `<a class="nav-link" href="/admin">${t('nav.admin')}</a>` : ``) +
      (isOwner ? `<a class="nav-link" href="#" id="ownerPreviewToggle" style="cursor:pointer;">${localStorage.getItem('dl_owner_preview')==='1' ? '🔓 ' + t('nav.previewOn') : '🔒 ' + t('nav.previewOff')}</a>` : ``) +
      `<a class="nav-link" href="#" id="logoutLink">${t('nav.logout')}</a>`;
    const lo = document.getElementById("logoutLink");
    if (lo) lo.onclick = logOut;
    // Owner-only QA bypass — lets the owner open any lesson in any level
    // directly, fully skipping the locked-path gate (see lessons.js's
    // dlGateActive()/dlOwnerPreviewActive() and path.html/lesson.html's use
    // of it). A reload is the simplest correct way for those pages to
    // re-run their gate/render logic with the new flag.
    if (isOwner) {
      const tgl = document.getElementById("ownerPreviewToggle");
      if (tgl) tgl.onclick = (e) => {
        e.preventDefault();
        const on = localStorage.getItem("dl_owner_preview") === "1";
        localStorage.setItem("dl_owner_preview", on ? "0" : "1");
        location.reload();
      };
    }
    if (isStudent && user) fetchHomeworkBadge();
  } else {
    const t = (typeof window.dlT === 'function') ? window.dlT : (k) => k;
    el.innerHTML = `<a class="nav-link" href="/login">${t('nav.login')}</a>`;
  }
}

renderAccount();
supabase.auth.onAuthStateChange((event) => {
  // A password-recovery link hands back a valid session but Supabase can
  // land the user on ANY page (whatever its Site URL / redirect resolves
  // to — often the home page). Wherever they land, route them to the page
  // that actually lets them set a new password. The recovery session
  // persists in localStorage, so /reset picks it up after the redirect.
  if (event === "PASSWORD_RECOVERY" &&
      !location.pathname.replace(/\/$/, "").endsWith("/reset")) {
    location.replace("/reset");
    return;
  }
  renderAccount();
});
const prevLangHook = window.dlOnLangChange;
window.dlOnLangChange = (lang) => { renderAccount(); if (prevLangHook) prevLangHook(lang); };
