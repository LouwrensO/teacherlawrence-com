// nav.js — instant, dependency-free account nav.
// Shows a Log out whenever a role is stored, even if the Supabase
// module is blocked. account.js enhances this with the signed-in email
// when it loads. Re-renders on language change.
function dlRenderNav() {
  var el = document.getElementById("accountNav");
  if (!el) return;
  var role = localStorage.getItem("dl_role");
  if (!role) {
    el.innerHTML = '<a class="nav-link" href="/login" data-i18n="nav.login">Log in</a>';
    if (typeof dlApplyI18n === 'function') dlApplyI18n(el);
    return;
  }
  var label = role === "teacher"
    ? "👩‍🏫 " + (typeof dlT === 'function' ? dlT('nav.teacher') : 'Teacher')
    : role === "parent"
    ? "👪 " + (typeof dlT === 'function' ? dlT('nav.parent') : 'Parent')
    : "🧑‍🎓 " + (typeof dlT === 'function' ? dlT('nav.student') : 'Student');
  var logoutLabel = typeof dlT === 'function' ? dlT('nav.logout') : 'Log out';
  el.innerHTML =
    '<span class="nav-link" style="cursor:default">' + label + "</span>" +
    '<a class="nav-link" href="#" id="logoutLink">' + logoutLabel + '</a>';
  var lo = document.getElementById("logoutLink");
  lo.onclick = function (e) {
    e.preventDefault();
    try { if (window.supabase && window.supabase.auth) window.supabase.auth.signOut(); } catch (_) {}
    localStorage.removeItem("dl_role");
    localStorage.removeItem("dl_level");
    // Role/level are remembered on the ACCOUNT now (not just this
    // browser), so logging out should just go home — logging back in
    // via /login will recognize the account and skip onboarding again.
    // Sending them straight to /onboard here would ask "teacher or
    // student?" before they've even had a chance to log back in.
    location.href = "/";
  };
}
(function () {
  dlRenderNav();
  var prev = window.dlOnLangChange;
  window.dlOnLangChange = function (lang) { dlRenderNav(); if (prev) prev(lang); };
})();
