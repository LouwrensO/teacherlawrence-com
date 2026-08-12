// api/_liveVoiceAllowlist.js — single source of truth for "Live Voice
// (Beta)" eligibility, shared between api/speak-chat.js (the real security
// boundary — mints the Gemini token) and api/access.js (tells the client
// whether to even show the tab). Keeping this in one file means the two
// checks can't silently drift apart.
//
// TEMPORARY test-phase seed list — the day-to-day way to grant/revoke a
// student is the /admin-voice page (sets profiles.live_voice_beta), not
// editing this array. Remove this list entirely once Tier 2 is ready for
// the full student cohort — see CLAUDE.md.
export const LIVE_TEST_ALLOWLIST = [
  "louwrensoberholzer@gmail.com",
  "josephine.sj.lim7@gmail.com",
  "kimharam1357@gmail.com"
];

export function isLiveVoiceAllowed(email, liveVoiceBetaFlag) {
  const emailAllowlisted = LIVE_TEST_ALLOWLIST.includes(String(email || "").toLowerCase());
  return emailAllowlisted || !!liveVoiceBetaFlag;
}
