// /api/access.js — plain REST check: is this token's user logged in / subscribed?
// Uses direct HTTPS calls to Supabase's own API (no client SDK, no external
// CDN), so this is fast and reliable even when a JS-library CDN is slow.
import { isLiveVoiceAllowed } from "./_liveVoiceAllowlist.js";

const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";
const PUBLISHABLE  = "sb_publishable_YBAbltikDkK6ag5PAjTJXg_99i6Yow8";

export default async function handler(req, res) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(200).json({ loggedIn: false, subscribed: false });

    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
    });
    if (!ur.ok) return res.status(200).json({ loggedIn: false, subscribed: false });
    const user = await ur.json();

    // Single combined lookup (used to be 3 separate round trips to
    // Supabase — merged into one to shrink the total time this endpoint
    // takes, since a slow chain of sequential requests here could exceed
    // public/lesson.html's client-side access-check timeout and make an
    // actually-logged-in student wrongly see the "please sign up" paywall).
    // All these columns are long-established in supabase/schema.sql, so
    // there's no more need to isolate each one in its own try/catch against
    // a not-yet-migrated column.
    let subscribed = false, trialEndsAt = null, role = null, level = null, classId = null, hideBibleTopic = false, liveVoiceBetaFlag = false;
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=subscribed,trial_ends_at,role,level,class_id,hide_bible_topic,live_voice_beta`, {
        headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
      });
      if (pr.ok) {
        const rows = await pr.json();
        if (rows && rows[0]) {
          subscribed = !!rows[0].subscribed;
          trialEndsAt = rows[0].trial_ends_at;
          role = rows[0].role || null;
          level = rows[0].level || null;
          classId = rows[0].class_id || null;
          hideBibleTopic = !!rows[0].hide_bible_topic;
          liveVoiceBetaFlag = !!rows[0].live_voice_beta;
        } else {
          // first time we've seen this user: start their 7-day free trial
          trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const key = process.env.SUPABASE_SECRET_KEY;
          if (key) {
            await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
              method: "POST",
              headers: {
                apikey: key, Authorization: "Bearer " + key,
                "Content-Type": "application/json",
                Prefer: "resolution=ignore-duplicates,return=minimal"
              },
              body: JSON.stringify([{ id: user.id, subscribed: false, trial_ends_at: trialEndsAt }])
            });
          }
        }
      }
    } catch (e) {}

    const trialing = !subscribed && !!trialEndsAt && new Date(trialEndsAt) > new Date();
    const classStudent = !!classId;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      loggedIn: true,
      // a class student's access is free (their teacher covers it), so they
      // count as "subscribed" for the paywall gate
      subscribed: subscribed || trialing || classStudent,
      trialing,
      trialEndsAt,
      role,
      level,
      classStudent,
      classId,
      hideBibleTopic,
      liveVoiceBeta: isLiveVoiceAllowed(user.email, liveVoiceBetaFlag),
      email: user.email || null
    });
  } catch (e) {
    return res.status(200).json({ loggedIn: false, subscribed: false });
  }
}
