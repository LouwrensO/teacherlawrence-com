// /api/save-profile.js — a small multiplexed endpoint (root /api is at
// Vercel Hobby's 12-function cap, so several concerns share this one file):
//
//   • remembers a logged-in user's role (teacher/student) + level on their
//     ACCOUNT, so logging out (which clears localStorage) doesn't re-ask the
//     onboarding question on the next login (even on another device).
//   • Practice Speaking "resume where you left off" store (practice_progress).
//   • daily practice-time log (practice_days) — powers the Path streak
//     calendar across devices AND the owner's admin dashboard.
//   • teacher invite codes: a teacher gets a code; a student who enters it is
//     linked to that teacher (profiles.teacher_id).
//   • owner-only admin aggregation (?admin=1): per-student time, activity,
//     streak, lessons.
const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const PUBLISHABLE = "YOUR-NEW-PUBLISHABLE-KEY";

// The site owner. Only this account can read the admin dashboard.
const OWNER_EMAIL = "louwrensoberholzer@gmail.com";

function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }

// consecutive days (ending today, or yesterday if today isn't practiced yet)
// present in a Set of 'YYYY-MM-DD' strings
function streakFromDays(daySet) {
  let streak = 0;
  const cur = new Date();
  if (!daySet.has(dayKey(cur))) cur.setUTCDate(cur.getUTCDate() - 1);
  while (daySet.has(dayKey(cur))) { streak++; cur.setUTCDate(cur.getUTCDate() - 1); }
  return streak;
}

export default async function handler(req, res) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "missing token" });

    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
    });
    if (!ur.ok) return res.status(401).json({ error: "invalid token" });
    const user = await ur.json();

    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });
    const svc = { apikey: secret, Authorization: "Bearer " + secret };
    const rest = (path, opts = {}) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });

    // ---------------------------------------------------------------- GET
    if (req.method === "GET") {
      // resume-where-you-left-off (Practice Speaking)
      if (req.query.lessonId) {
        const pr = await rest(`practice_progress?user_id=eq.${user.id}&lesson_id=eq.${encodeURIComponent(req.query.lessonId)}&select=idx`);
        if (!pr.ok) return res.status(502).json({ error: "lookup failed" });
        const rows = await pr.json();
        return res.status(200).json({ idx: (rows && rows[0]) ? rows[0].idx : null });
      }

      // the current user's own practice days (for the streak calendar)
      if (req.query.streak) {
        const pr = await rest(`practice_days?user_id=eq.${user.id}&select=day,seconds`);
        if (!pr.ok) return res.status(502).json({ error: "lookup failed" });
        return res.status(200).json({ days: await pr.json() });
      }

      // the current user's own real per-lesson completion state (see
      // lesson_progress table / body.progress below) — keyed by lessonId
      // so public/path.html can merge it straight over its localStorage set.
      if (req.query.progress) {
        const pr = await rest(`lesson_progress?user_id=eq.${user.id}&select=lesson_id,state,steps`);
        if (!pr.ok) return res.status(502).json({ error: "lookup failed" });
        const rows = await pr.json();
        const progress = {};
        (rows || []).forEach(r => { progress[r.lesson_id] = { state: r.state, steps: r.steps || {} }; });
        return res.status(200).json({ progress });
      }

      // the current user's own per-question pass/attempt state for ONE
      // lesson (see question_attempts table) — used by public/lesson.html
      // to hydrate the in-lesson gate on load, so a refresh mid-lesson
      // doesn't reset which items are already passed or how many attempts
      // have been made on the current one.
      if (req.query.questionAttempts) {
        const lessonId = String(req.query.questionAttempts);
        const qr = await rest(`question_attempts?user_id=eq.${user.id}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=step_type,item_index,attempts,passed,needed_help,last_score`);
        if (!qr.ok) return res.status(502).json({ error: "lookup failed" });
        return res.status(200).json({ attempts: await qr.json() });
      }

      // a teacher's invite code (created on first request)
      if (req.query.invite) {
        const pr = await rest(`profiles?id=eq.${user.id}&select=invite_code`);
        const rows = pr.ok ? await pr.json() : [];
        let code = rows && rows[0] && rows[0].invite_code;
        if (!code) {
          code = genCode();
          const up = await rest(`profiles`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify([{ id: user.id, invite_code: code, email: user.email, updated_at: new Date().toISOString() }])
          });
          if (!up.ok) return res.status(502).json({ error: "could not create invite code", detail: (await up.text()).slice(0, 200) });
        }
        return res.status(200).json({ code });
      }

      // a parent's list of their children
      if (req.query.children) {
        const cr = await rest(`profiles?parent_id=eq.${user.id}&select=id,username,name,level&order=name`);
        if (!cr.ok) return res.status(502).json({ error: "could not list children", detail: (await cr.text()).slice(0, 200) });
        return res.status(200).json({ ok: true, children: await cr.json() });
      }

      // a teacher's classes (with student + assignment counts)
      if (req.query.classes) {
        const [cr, sr] = await Promise.all([
          rest(`classes?teacher_id=eq.${user.id}&select=id,name,join_code,created_at&order=created_at.desc`),
          rest(`profiles?teacher_id=eq.${user.id}&select=id,class_id`)
        ]);
        const classes = cr.ok ? await cr.json() : [];
        const students = sr.ok ? await sr.json() : [];
        const countByClass = {};
        students.forEach(s => { if (s.class_id) countByClass[s.class_id] = (countByClass[s.class_id] || 0) + 1; });
        const ids = classes.map(c => c.id);
        const asgByClass = {};
        if (ids.length) {
          const ar = await rest(`assignments?class_id=in.(${ids.join(",")})&select=class_id`);
          if (ar.ok) (await ar.json()).forEach(a => { asgByClass[a.class_id] = (asgByClass[a.class_id] || 0) + 1; });
        }
        return res.status(200).json({ ok: true, classes: classes.map(c => ({
          id: c.id, name: c.name, code: c.join_code, created: c.created_at,
          students: countByClass[c.id] || 0, assignments: asgByClass[c.id] || 0
        })) });
      }

      // students in one of my classes, with a progress summary each
      if (req.query.classId) {
        const cid = req.query.classId;
        const own = await rest(`classes?id=eq.${encodeURIComponent(cid)}&teacher_id=eq.${user.id}&select=id,name,join_code`);
        const crow = own.ok ? (await own.json())[0] : null;
        if (!crow) return res.status(403).json({ error: "not your class" });
        const sr = await rest(`profiles?class_id=eq.${encodeURIComponent(cid)}&select=id,name,username,email,level`);
        const students = sr.ok ? await sr.json() : [];
        const prog = await progressFor(rest, students.map(s => s.id));
        const asg = await assignmentsFor(rest, cid, students.map(s => s.id));
        return res.status(200).json({
          ok: true,
          class: { id: crow.id, name: crow.name, code: crow.join_code },
          assignments: asg,
          students: students.map(s => ({
            id: s.id, name: s.name || s.username || (s.email || "").split("@")[0],
            username: s.username || null, level: s.level || null, ...prog[s.id]
          }))
        });
      }

      // one of my students, in detail (progress + practice-day calendar + homework)
      if (req.query.student) {
        const sid = req.query.student;
        const vr = await rest(`profiles?id=eq.${encodeURIComponent(sid)}&select=id,name,username,email,level,teacher_id,class_id`);
        const srow = vr.ok ? (await vr.json())[0] : null;
        if (!srow || srow.teacher_id !== user.id) return res.status(403).json({ error: "not your student" });
        const prog = await progressFor(rest, [sid]);
        const dr = await rest(`practice_days?user_id=eq.${encodeURIComponent(sid)}&select=day,seconds`);
        const days = dr.ok ? await dr.json() : [];
        const homework = srow.class_id ? await homeworkFor(rest, srow.class_id, sid) : [];
        return res.status(200).json({
          ok: true,
          student: {
            id: srow.id, name: srow.name || srow.username || (srow.email || "").split("@")[0],
            username: srow.username || null, level: srow.level || null,
            directLogin: /@kids\.teacherlawrence\.com$/i.test(srow.email || ""), ...prog[sid]
          },
          days, homework
        });
      }

      // a student's Speaking Homework log (every scored spoken answer,
      // chronological). Kept separate from the `homework` list above:
      // Speaking Homework isn't assignment-scoped (it's available any
      // time, not just when a teacher assigned that lesson), and shows
      // every individual graded answer rather than one best-score pill
      // per activity. `score=not.is.null` excludes the bare (unscored)
      // rows api/speak-chat.js also writes per Talk-with-AI turn.
      if (req.query.speakingLog) {
        const sid = req.query.speakingLog;
        const vr = await rest(`profiles?id=eq.${encodeURIComponent(sid)}&select=teacher_id`);
        const srow = vr.ok ? (await vr.json())[0] : null;
        if (!srow || srow.teacher_id !== user.id) return res.status(403).json({ error: "not your student" });
        const sr = await rest(`submissions?student_id=eq.${encodeURIComponent(sid)}&activity=in.(speaking,comprehension)&score=not.is.null&select=lesson_id,activity,score,max,ai_feedback,created_at&order=created_at.desc&limit=50`);
        const rows = sr.ok ? await sr.json() : [];
        return res.status(200).json({ ok: true, log: rows.map(r => ({
          lessonId: r.lesson_id, activity: r.activity, score: r.score, max: r.max, feedback: r.ai_feedback, created: r.created_at
        })) });
      }

      // a teacher's "tonight's plan" view for one student: their last
      // lesson, recently-touched lessons (so the picker can skip them when
      // suggesting what's next), and the currently-active plan. If the
      // student has no personal plan yet, falls back to their class's
      // default plan (set the moment the class was created) and flags
      // `inherited` so the picker can say so.
      if (req.query.plan) {
        const sid = req.query.plan;
        const vr = await rest(`profiles?id=eq.${encodeURIComponent(sid)}&select=teacher_id,class_id`);
        const srow = vr.ok ? (await vr.json())[0] : null;
        if (!srow || srow.teacher_id !== user.id) return res.status(403).json({ error: "not your student" });
        const [pr, cr] = await Promise.all([
          rest(`practice_progress?user_id=eq.${encodeURIComponent(sid)}&select=lesson_id,updated_at&order=updated_at.desc&limit=8`),
          rest(`student_plan?student_id=eq.${encodeURIComponent(sid)}&select=lesson_id&order=position.asc`)
        ]);
        const recent = pr.ok ? await pr.json() : [];
        let current = cr.ok ? await cr.json() : [];
        let inherited = false;
        if (!current.length && srow.class_id) {
          const cpr = await rest(`class_plan?class_id=eq.${encodeURIComponent(srow.class_id)}&select=lesson_id&order=position.asc`);
          current = cpr.ok ? await cpr.json() : [];
          inherited = current.length > 0;
        }
        return res.status(200).json({
          ok: true,
          lastLesson: recent[0] ? { lessonId: recent[0].lesson_id, updated: recent[0].updated_at } : null,
          recentLessonIds: recent.map(r => r.lesson_id),
          plan: current.map(c => c.lesson_id),
          inherited
        });
      }

      // a teacher's default plan for a whole class — settable before any
      // student has joined; whoever joins later inherits it (see ?myPlan=1
      // and ?plan=<studentId> above) until they get a personal plan.
      if (req.query.classPlan) {
        const cid = req.query.classPlan;
        const own = await rest(`classes?id=eq.${encodeURIComponent(cid)}&teacher_id=eq.${user.id}&select=id`);
        const crow = own.ok ? (await own.json())[0] : null;
        if (!crow) return res.status(403).json({ error: "not your class" });
        const cpr = await rest(`class_plan?class_id=eq.${encodeURIComponent(cid)}&select=lesson_id&order=position.asc`);
        const rows = cpr.ok ? await cpr.json() : [];
        return res.status(200).json({ ok: true, plan: rows.map(r => r.lesson_id) });
      }

      // the CALLER's own active plan (a student checking what's live for
      // them) — personal plan if they have one, else their class's default.
      if (req.query.myPlan) {
        const cr = await rest(`student_plan?student_id=eq.${user.id}&select=lesson_id&order=position.asc`);
        let rows = cr.ok ? await cr.json() : [];
        if (!rows.length) {
          const pr = await rest(`profiles?id=eq.${user.id}&select=class_id`);
          const prow = pr.ok ? (await pr.json())[0] : null;
          const classId = prow && prow.class_id;
          if (classId) {
            const cpr = await rest(`class_plan?class_id=eq.${encodeURIComponent(classId)}&select=lesson_id&order=position.asc`);
            rows = cpr.ok ? await cpr.json() : [];
          }
        }
        return res.status(200).json({ ok: true, plan: rows.map(r => r.lesson_id) });
      }

      // the CALLER's own assigned homework (class students only)
      if (req.query.homework) {
        const pr = await rest(`profiles?id=eq.${user.id}&select=class_id`);
        const prow = pr.ok ? (await pr.json())[0] : null;
        const classId = prow && prow.class_id;
        if (!classId) return res.status(200).json({ ok: true, inClass: false, assignments: [] });
        const homework = await homeworkFor(rest, classId, user.id);
        return res.status(200).json({ ok: true, inClass: true, assignments: homework });
      }

      // the CALLER's own Speaking Homework log — unlike ?homework= above,
      // NOT gated behind being in a class: Speaking Homework itself works
      // for any subscribed student on any lesson at any time (see
      // api/speak-chat.js's mode:'score'), so this shouldn't be either.
      // Same shape as the teacher's ?speakingLog= (self access, no
      // ownership check needed — it's always the caller's own data).
      if (req.query.mySpeakingLog) {
        const sr = await rest(`submissions?student_id=eq.${user.id}&activity=in.(speaking,comprehension)&score=not.is.null&select=lesson_id,activity,score,max,ai_feedback,created_at&order=created_at.desc&limit=50`);
        const rows = sr.ok ? await sr.json() : [];
        return res.status(200).json({ ok: true, log: rows.map(r => ({
          lessonId: r.lesson_id, activity: r.activity, score: r.score, max: r.max, feedback: r.ai_feedback, created: r.created_at
        })) });
      }

      // owner-only admin dashboard
      if (req.query.admin) {
        if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
        return adminData(res, user, svc, rest);
      }

      // owner-only: one account in detail (progress, calendar, billing) —
      // same shape as a teacher's per-student view, but for ANY account,
      // not just ones this owner teaches.
      if (req.query.adminStudent) {
        if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
        const sid = req.query.adminStudent;
        const [vr, au] = await Promise.all([
          rest(`profiles?id=eq.${encodeURIComponent(sid)}&select=id,name,username,email,level,role,subscribed,stripe_customer_id,trial_ends_at,teacher_id,class_id`),
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(sid)}`, { headers: svc })
        ]);
        const srow = vr.ok ? (await vr.json())[0] : null;
        if (!srow) return res.status(404).json({ error: "not found" });
        // the auth admin API is the RELIABLE source for email (profiles.email
        // is only stamped opportunistically by some write paths and is often
        // empty) — same reasoning as adminData() below for the list view.
        const authUser = au.ok ? await au.json() : null;
        const email = (authUser && authUser.email) || srow.email || null;
        const metaName = authUser && authUser.user_metadata && authUser.user_metadata.name;
        const prog = await progressFor(rest, [sid]);
        const [dr, lr] = await Promise.all([
          rest(`practice_days?user_id=eq.${encodeURIComponent(sid)}&select=day,seconds`),
          rest(`practice_progress?user_id=eq.${encodeURIComponent(sid)}&select=lesson_id,updated_at&order=updated_at.desc&limit=50`)
        ]);
        const days = dr.ok ? await dr.json() : [];
        const lessonHistory = lr.ok ? await lr.json() : [];
        const homework = srow.class_id ? await homeworkFor(rest, srow.class_id, sid) : [];
        return res.status(200).json({
          ok: true,
          student: {
            id: srow.id, name: srow.name || metaName || srow.username || (email || "").split("@")[0],
            username: srow.username || null, email, level: srow.level || null, role: srow.role || null,
            subscribed: !!srow.subscribed, hasStripeCustomer: !!srow.stripe_customer_id, trialEndsAt: srow.trial_ends_at || null,
            classId: srow.class_id || null, ...prog[sid]
          },
          days, homework,
          lessonHistory: lessonHistory.map(r => ({ lessonId: r.lesson_id, updated: r.updated_at }))
        });
      }

      return res.status(400).json({ error: "unknown GET" });
    }

    // --------------------------------------------------------------- POST
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};

    // ---- child accounts (a parent manages their kids' logins) ----------
    // A child is a normal Supabase user whose "email" is a hidden
    // username@kids.teacherlawrence.com address, so small kids with no real
    // email can still self-log-in with just a username + PIN. Their
    // progress/level then hang off their own user id like any user.
    const KIDS_DOMAIN = "kids.teacherlawrence.com";

    // parent creates a child login
    if (body.createChild) {
      const c = body.createChild || {};
      const username = String(c.username || "").trim().toLowerCase();
      const pin = String(c.pin || "").trim();
      const name = String(c.name || "").trim().slice(0, 40);
      const level = c.level ? String(c.level) : null;
      if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(username))
        return res.status(400).json({ error: "username must be 3–20 letters, numbers or _ (lowercase)" });
      if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4–6 digits" });
      if (!name) return res.status(400).json({ error: "please give the child a name" });

      const email = `${username}@${KIDS_DOMAIN}`;
      // create the auth user (service key). email_confirm so they can log in now.
      const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pin, email_confirm: true, user_metadata: { name, is_child: true } })
      });
      if (!cr.ok) {
        const t = await cr.text();
        if (cr.status === 422 || /already|exists|registered/i.test(t))
          return res.status(409).json({ error: "That username is already taken — try another." });
        return res.status(502).json({ error: "could not create child login", detail: t.slice(0, 200) });
      }
      const nu = await cr.json();
      const childId = nu.id || (nu.user && nu.user.id);
      // save the profile row (links the child to this parent). Give the
      // child the same 7-day free trial a new signup gets, so they're not
      // paywalled the moment they log in (per-student billing comes later).
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const pr = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: childId, username, name, parent_id: user.id, role: "student", level, email, trial_ends_at: trialEndsAt, updated_at: new Date().toISOString() }])
      });
      if (!pr.ok) {
        // roll back the auth user so we don't leave an orphan login
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${childId}`, { method: "DELETE", headers: svc }).catch(() => {});
        return res.status(502).json({ error: "could not save child profile", detail: (await pr.text()).slice(0, 200) });
      }
      return res.status(200).json({ ok: true, child: { id: childId, username, name, level } });
    }

    // teacher creates a student login DIRECTLY in one of their classes —
    // same username+PIN, no-email shape as createChild above, but for
    // students in a physical class (many young kids have no email at all).
    // They land straight in the class, free, via class_id (same as the
    // join-by-code path), no separate "join" step needed.
    if (body.createClassStudent) {
      const c = body.createClassStudent || {};
      const classId = String(c.classId || "");
      const username = String(c.username || "").trim().toLowerCase();
      const pin = String(c.pin || "").trim();
      const name = String(c.name || "").trim().slice(0, 40);
      const level = c.level ? String(c.level) : null;
      if (!classId) return res.status(400).json({ error: "classId required" });
      if (!/^[a-z0-9][a-z0-9_]{2,19}$/.test(username))
        return res.status(400).json({ error: "username must be 3–20 letters, numbers or _ (lowercase)" });
      if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4–6 digits" });
      if (!name) return res.status(400).json({ error: "please give the student a name" });

      const own = await rest(`classes?id=eq.${encodeURIComponent(classId)}&teacher_id=eq.${user.id}&select=id`);
      const crow = own.ok ? (await own.json())[0] : null;
      if (!crow) return res.status(403).json({ error: "not your class" });

      const email = `${username}@${KIDS_DOMAIN}`;
      const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pin, email_confirm: true, user_metadata: { name, is_child: true } })
      });
      if (!cr.ok) {
        const t = await cr.text();
        if (cr.status === 422 || /already|exists|registered/i.test(t))
          return res.status(409).json({ error: "That username is already taken — try another." });
        return res.status(502).json({ error: "could not create student login", detail: t.slice(0, 200) });
      }
      const nu = await cr.json();
      const studentId = nu.id || (nu.user && nu.user.id);
      const pr = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: studentId, username, name, class_id: classId, teacher_id: user.id, role: "student", level, email, updated_at: new Date().toISOString() }])
      });
      if (!pr.ok) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${studentId}`, { method: "DELETE", headers: svc }).catch(() => {});
        return res.status(502).json({ error: "could not save student profile", detail: (await pr.text()).slice(0, 200) });
      }
      return res.status(200).json({ ok: true, student: { id: studentId, username, name, level } });
    }

    // parent resets a child's PIN
    if (body.setChildPin) {
      const childId = String(body.setChildPin.childId || "");
      const pin = String(body.setChildPin.pin || "").trim();
      if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4–6 digits" });
      const own = await childOwnedBy(rest, childId, user.id);
      if (!own) return res.status(403).json({ error: "not your child" });
      const ur2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${childId}`, {
        method: "PUT", headers: { ...svc, "Content-Type": "application/json" }, body: JSON.stringify({ password: pin })
      });
      if (!ur2.ok) return res.status(502).json({ error: "could not reset PIN", detail: (await ur2.text()).slice(0, 200) });
      return res.status(200).json({ ok: true });
    }

    // parent removes a child login
    if (body.removeChild) {
      const childId = String((body.removeChild && body.removeChild.childId) || body.removeChild || "");
      const own = await childOwnedBy(rest, childId, user.id);
      if (!own) return res.status(403).json({ error: "not your child" });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${childId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await rest(`profiles?id=eq.${encodeURIComponent(childId)}`, { method: "DELETE" }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // teacher resets a class student's PIN (same shape as setChildPin, but
    // ownership is via teacher_id since class students aren't "family")
    if (body.resetStudentPin) {
      const studentId = String(body.resetStudentPin.studentId || "");
      const pin = String(body.resetStudentPin.pin || "").trim();
      if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4–6 digits" });
      const own = await studentOwnedBy(rest, studentId, user.id);
      if (!own) return res.status(403).json({ error: "not your student" });
      const ur2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${studentId}`, {
        method: "PUT", headers: { ...svc, "Content-Type": "application/json" }, body: JSON.stringify({ password: pin })
      });
      if (!ur2.ok) return res.status(502).json({ error: "could not reset PIN", detail: (await ur2.text()).slice(0, 200) });
      return res.status(200).json({ ok: true });
    }

    // teacher sets the up-to-5 lessons currently "live" for one student —
    // replaces whatever plan was there before (last write wins).
    if (body.setStudentPlan) {
      const p = body.setStudentPlan || {};
      const studentId = String(p.studentId || "");
      const lessonIds = (Array.isArray(p.lessonIds) ? p.lessonIds : []).map(String).filter(Boolean).slice(0, 5);
      if (!studentId) return res.status(400).json({ error: "studentId required" });
      const own = await studentOwnedBy(rest, studentId, user.id);
      if (!own) return res.status(403).json({ error: "not your student" });
      const del = await rest(`student_plan?student_id=eq.${encodeURIComponent(studentId)}`, { method: "DELETE" });
      if (!del.ok) return res.status(502).json({ error: "could not update plan", detail: (await del.text()).slice(0, 200) });
      if (lessonIds.length) {
        const rows = lessonIds.map((lessonId, i) => ({ student_id: studentId, teacher_id: user.id, lesson_id: lessonId, position: i }));
        const ir = await rest(`student_plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(rows)
        });
        if (!ir.ok) return res.status(502).json({ error: "could not save plan", detail: (await ir.text()).slice(0, 200) });
      }
      return res.status(200).json({ ok: true, count: lessonIds.length });
    }

    // teacher sets the class-wide default plan — works before any student
    // has joined; replaces whatever was there before.
    if (body.setClassPlan) {
      const p = body.setClassPlan || {};
      const classId = String(p.classId || "");
      const lessonIds = (Array.isArray(p.lessonIds) ? p.lessonIds : []).map(String).filter(Boolean).slice(0, 5);
      if (!classId) return res.status(400).json({ error: "classId required" });
      const own = await rest(`classes?id=eq.${encodeURIComponent(classId)}&teacher_id=eq.${user.id}&select=id`);
      const crow = own.ok ? (await own.json())[0] : null;
      if (!crow) return res.status(403).json({ error: "not your class" });
      const del = await rest(`class_plan?class_id=eq.${encodeURIComponent(classId)}`, { method: "DELETE" });
      if (!del.ok) return res.status(502).json({ error: "could not update plan", detail: (await del.text()).slice(0, 200) });
      if (lessonIds.length) {
        const rows = lessonIds.map((lessonId, i) => ({ class_id: classId, teacher_id: user.id, lesson_id: lessonId, position: i }));
        const ir = await rest(`class_plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(rows)
        });
        if (!ir.ok) return res.status(502).json({ error: "could not save plan", detail: (await ir.text()).slice(0, 200) });
      }
      return res.status(200).json({ ok: true, count: lessonIds.length });
    }

    // teacher removes a class student login they created directly
    if (body.removeStudent) {
      const studentId = String((body.removeStudent && body.removeStudent.studentId) || body.removeStudent || "");
      const own = await studentOwnedBy(rest, studentId, user.id);
      if (!own) return res.status(403).json({ error: "not your student" });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${studentId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await rest(`profiles?id=eq.${encodeURIComponent(studentId)}`, { method: "DELETE" }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // ---- owner-only admin actions (billing + account cleanup) -----------
    // Gated the same way as GET ?admin=1 / ?adminStudent=<id> above: only
    // OWNER_EMAIL. These act on ANY account, not just ones this owner teaches.
    if (body.adminSetSubscribed) {
      if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
      const p = body.adminSetSubscribed || {};
      const userId = String(p.userId || "");
      if (!userId) return res.status(400).json({ error: "userId required" });
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: userId, subscribed: !!p.subscribed, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "could not update", detail: (await r.text()).slice(0, 200) });
      return res.status(200).json({ ok: true });
    }

    // grants/revokes one account's access to the Google AI Voice (Gemini
    // Live) test-phase beta — free, no payment needed. See profiles.
    // live_voice_beta and api/speak-chat.js's mode:'live-token' gate, which
    // reads this flag alongside the hardcoded LIVE_TEST_ALLOWLIST seed list.
    if (body.adminSetLiveVoice) {
      if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
      const p = body.adminSetLiveVoice || {};
      const userId = String(p.userId || "");
      if (!userId) return res.status(400).json({ error: "userId required" });
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: userId, live_voice_beta: !!p.enabled, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "could not update", detail: (await r.text()).slice(0, 200) });
      return res.status(200).json({ ok: true });
    }

    // cancels any active Stripe subscription on file for this account (so
    // they stop being billed) and clears the subscribed flag — a class
    // student keeps free access via their teacher regardless (see access.js)
    if (body.adminCancelSubscription) {
      if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
      const userId = String((body.adminCancelSubscription && body.adminCancelSubscription.userId) || "");
      if (!userId) return res.status(400).json({ error: "userId required" });
      const vr = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id`);
      const prow = vr.ok ? (await vr.json())[0] : null;
      const canceled = await cancelStripeSubscriptions(prow && prow.stripe_customer_id);
      await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: userId, subscribed: false, current_period_end: null, updated_at: new Date().toISOString() }])
      });
      return res.status(200).json({ ok: true, canceled });
    }

    // permanently deletes an account's login (cancelling any live Stripe
    // subscription first, so nobody keeps being billed with no way to log
    // in and manage it). Irreversible — the client confirms before calling.
    if (body.adminDeleteUser) {
      if ((user.email || "").toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "not authorized" });
      const userId = String((body.adminDeleteUser && body.adminDeleteUser.userId) || "");
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (userId === user.id) return res.status(400).json({ error: "cannot delete your own account here" });
      const vr = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id`);
      const prow = vr.ok ? (await vr.json())[0] : null;
      if (prow && prow.stripe_customer_id) await cancelStripeSubscriptions(prow.stripe_customer_id).catch(() => {});
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
      await rest(`profiles?id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // ---- classes (a teacher runs classes; students join by code) --------
    // teacher creates a class → gets a short join code to share
    if (body.createClass) {
      const name = String(body.createClass.name || "").trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: "please name the class" });
      let code = "";
      for (let t = 0; t < 6; t++) {
        code = genCode();
        const chk = await rest(`classes?join_code=eq.${code}&select=id`);
        const rows = chk.ok ? await chk.json() : [];
        if (!rows.length) break;
      }
      const cr = await rest(`classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify([{ teacher_id: user.id, name, join_code: code }])
      });
      if (!cr.ok) return res.status(502).json({ error: "could not create class", detail: (await cr.text()).slice(0, 200) });
      const row = (await cr.json())[0];
      // make sure this account is flagged a teacher (and its email stamped)
      await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: user.id, role: "teacher", email: user.email, updated_at: new Date().toISOString() }])
      }).catch(() => {});
      return res.status(200).json({ ok: true, class: { id: row.id, name: row.name, code: row.join_code } });
    }

    // student joins a class by code (links class_id + teacher_id). Free —
    // class students don't pay; the paywall is only for independent signups.
    if (body.joinClass) {
      const code = String((body.joinClass && body.joinClass.code) || body.joinClass || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "enter a class code" });
      const cr = await rest(`classes?join_code=eq.${encodeURIComponent(code)}&select=id,teacher_id,name`);
      const crow = cr.ok ? (await cr.json())[0] : null;
      if (!crow) return res.status(404).json({ error: "invalid class code" });
      if (crow.teacher_id === user.id) return res.status(400).json({ error: "that's your own class" });
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: user.id, class_id: crow.id, teacher_id: crow.teacher_id, role: "student", email: user.email, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "could not join", detail: (await r.text()).slice(0, 200) });
      return res.status(200).json({ ok: true, className: crow.name });
    }

    // teacher assigns a lesson as homework to one of their classes.
    // Idempotent: re-assigning the same lesson to the same class is a no-op
    // (returns the existing assignment) so a teacher can safely hit the
    // button again without creating duplicates.
    if (body.assignHomework) {
      const classId = String((body.assignHomework && body.assignHomework.classId) || "");
      const lessonId = String((body.assignHomework && body.assignHomework.lessonId) || "");
      if (!classId || !lessonId) return res.status(400).json({ error: "classId and lessonId required" });
      const own = await rest(`classes?id=eq.${encodeURIComponent(classId)}&teacher_id=eq.${user.id}&select=id,name`);
      const crow = own.ok ? (await own.json())[0] : null;
      if (!crow) return res.status(403).json({ error: "not your class" });
      const ex = await rest(`assignments?class_id=eq.${encodeURIComponent(classId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=id`);
      const exRows = ex.ok ? await ex.json() : [];
      if (exRows.length) return res.status(200).json({ ok: true, alreadyAssigned: true, className: crow.name });
      const ar = await rest(`assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify([{ class_id: classId, lesson_id: lessonId }])
      });
      if (!ar.ok) return res.status(502).json({ error: "could not assign", detail: (await ar.text()).slice(0, 200) });
      return res.status(200).json({ ok: true, className: crow.name });
    }

    // a student saves the result of a homework activity (game score, etc).
    // Only recorded when the student is currently IN A CLASS that has this
    // lesson assigned — independent (paying) students aren't being tracked
    // by a teacher, so there's nothing useful to attach the score to.
    if (body.submit) {
      const s = body.submit || {};
      const lessonId = String(s.lessonId || "");
      const activity = String(s.activity || "");
      if (!lessonId || !activity) return res.status(400).json({ error: "lessonId and activity required" });
      const pr = await rest(`profiles?id=eq.${user.id}&select=class_id`);
      const prow = pr.ok ? (await pr.json())[0] : null;
      const classId = prow && prow.class_id;
      if (!classId) return res.status(200).json({ ok: true, tracked: false }); // not in a class — nothing to record against
      const ar = await rest(`assignments?class_id=eq.${encodeURIComponent(classId)}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=id`);
      const arow = ar.ok ? (await ar.json())[0] : null;
      if (!arow) return res.status(200).json({ ok: true, tracked: false }); // not assigned — nothing to record against
      const row = {
        assignment_id: arow.id, student_id: user.id, lesson_id: lessonId, activity,
        score: s.score != null ? Math.round(s.score) : null,
        max: s.max != null ? Math.round(s.max) : null,
        seconds: s.seconds != null ? Math.round(s.seconds) : null
      };
      const ir = await rest(`submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify([row])
      });
      if (!ir.ok) return res.status(502).json({ error: "save failed", detail: (await ir.text()).slice(0, 300) });
      return res.status(200).json({ ok: true, tracked: true });
    }

    // Locked-path per-question gate: the client (public/lesson.html, a
    // student on the locked path) reports one attempt at one item. attempts
    // is incremented SERVER-SIDE (not trusted from the client) so it can't
    // drift across reloads/tabs; needed_help flips true on the 3rd failed
    // attempt, which is the client's cue to reveal the answer and let the
    // student move on anyway (see dlGateAttempt() in lesson.html).
    if (body.questionAttempt) {
      const qa = body.questionAttempt || {};
      const lessonId = String(qa.lessonId || "");
      const stepType = String(qa.stepType || "");
      const itemIndex = Number.isFinite(qa.itemIndex) ? Math.round(qa.itemIndex) : 0;
      if (!lessonId || !stepType) return res.status(400).json({ error: "lessonId and stepType required" });
      const passed = !!qa.passed;
      const score = qa.score != null ? Math.round(qa.score) : null;
      const er = await rest(`question_attempts?user_id=eq.${user.id}&lesson_id=eq.${encodeURIComponent(lessonId)}&step_type=eq.${encodeURIComponent(stepType)}&item_index=eq.${itemIndex}&select=attempts,passed`);
      const eRows = er.ok ? await er.json() : [];
      const prevAttempts = (eRows[0] && eRows[0].attempts) || 0;
      const prevPassed = !!(eRows[0] && eRows[0].passed);
      const attempts = prevAttempts + 1;
      const nowPassed = prevPassed || passed;
      const neededHelp = !nowPassed && attempts >= 3;
      const row = {
        user_id: user.id, lesson_id: lessonId, step_type: stepType, item_index: itemIndex,
        attempts, passed: nowPassed, needed_help: neededHelp, last_score: score,
        updated_at: new Date().toISOString()
      };
      const ir = await rest(`question_attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row])
      });
      if (!ir.ok) return res.status(502).json({ error: "save failed", detail: (await ir.text()).slice(0, 300) });
      return res.status(200).json({ ok: true, attempts, passed: nowPassed, neededHelp });
    }

    // Real per-lesson completion — replaces the old client-only "mark done
    // the instant the lesson opens" behaviour a teacher flagged as
    // meaningless. The client sends one attempted step at a time
    // (read/comprehension/game/talk — see public/lesson.html's
    // dlProgressTouch()); this endpoint merges it into that lesson's steps
    // and recomputes `state` SERVER-SIDE each time, so it can't be spoofed
    // by editing localStorage the way the old flag could. "done" requires
    // at least 3 of the 4 steps AND at least one of comprehension/talk —
    // that second clause stops a student reaching green purely by playing
    // the vocabulary games without ever reading, answering, or talking.
    if (body.progress) {
      const p = body.progress || {};
      const lessonId = String(p.lessonId || "");
      const step = p.step ? String(p.step) : "";
      // only these four count toward "done" below; other step names (e.g.
      // 'opened', sent once when the lesson is first loaded) still create/
      // touch the row — so a lesson that's merely been opened shows as
      // in_progress on the Path (not "not started"), without themselves
      // counting as real progress the way finishing a task does.
      const STEPS = ["read", "comprehension", "game", "talk"];
      // score is optional and separate from step: sent once, from the
      // lesson's Results slide (see lessonRepaintResults() in
      // lesson.html), with the final { sum, max, pct, parts } tally.
      // Stored under its own key in the same `steps` JSONB bag rather
      // than a new column, so a teacher-facing view can read it straight
      // off this same table/row without a schema migration.
      const score = (p.score && typeof p.score === "object") ? p.score : null;
      if (!lessonId || (!step && !score)) return res.status(400).json({ error: "lessonId and step (or score) required" });
      const er = await rest(`lesson_progress?user_id=eq.${user.id}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=steps`);
      const eRows = er.ok ? await er.json() : [];
      const steps = Object.assign({}, (eRows[0] && eRows[0].steps) || {}, step ? { [step]: true } : {});
      if (score) steps.finalScore = score;
      const doneCount = STEPS.filter(k => steps[k]).length;
      const anchored = !!(steps.comprehension || steps.talk);
      // allPassed (set once by lesson.html when every gated item on the
      // locked path has been passed) is a strict superset of the old
      // heuristic — it can only additionally flip a lesson to done, never
      // regress one that already qualified.
      const state = ((doneCount >= 3 && anchored) || steps.allPassed) ? "done" : "in_progress";
      const now = new Date().toISOString();
      const row = { user_id: user.id, lesson_id: lessonId, steps, state, updated_at: now };
      if (state === "done") row.done_at = now;
      const ir = await rest(`lesson_progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row])
      });
      if (!ir.ok) return res.status(502).json({ error: "save failed", detail: (await ir.text()).slice(0, 300) });
      return res.status(200).json({ ok: true, state, steps });
    }

    // daily practice time — client sends the cumulative seconds for that day
    if (body.day != null && body.seconds != null) {
      const row = { user_id: user.id, day: body.day, seconds: Math.round(body.seconds), updated_at: new Date().toISOString() };
      const r = await rest(`practice_days`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row])
      });
      if (!r.ok) return res.status(502).json({ error: "save failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ ok: true });
    }

    // join a teacher by invite code
    if (body.join) {
      const code = String(body.join).trim().toUpperCase();
      const tr = await rest(`profiles?invite_code=eq.${encodeURIComponent(code)}&select=id`);
      const rows = tr.ok ? await tr.json() : [];
      if (!rows || !rows[0]) return res.status(404).json({ error: "invalid code" });
      const teacherId = rows[0].id;
      if (teacherId === user.id) return res.status(400).json({ error: "cannot join yourself" });
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: user.id, teacher_id: teacherId, email: user.email, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "join failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ ok: true });
    }

    // resume-where-you-left-off (Practice Speaking)
    if (body.lessonId != null && body.idx != null) {
      const row = { user_id: user.id, lesson_id: body.lessonId, idx: body.idx, updated_at: new Date().toISOString() };
      const r = await rest(`practice_progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row])
      });
      if (!r.ok) return res.status(502).json({ error: "save failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ ok: true });
    }

    // Active learning-path level switch (see public/path.html's level
    // switcher) — deliberately separate from the role+level onboarding
    // handler below since this is called repeatedly after onboarding
    // whenever a student switches levels, and must never require
    // resending/overwriting role. No enum validation against LEVELS,
    // consistent with the onboarding handler below not validating level.
    if (typeof body.setLevel === "string" && body.setLevel) {
      const lv = body.setLevel.slice(0, 20);
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: user.id, level: lv, email: user.email, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "save failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ ok: true, level: lv });
    }

    // "Hide Bible lessons" preference (Bible lessons are visible/free for
    // everyone by default — see api/access.js for how it's read back and
    // public/index.html for the toggle). A pure account opt-OUT, not tied
    // to role/level.
    if (typeof body.hideBibleTopic === "boolean") {
      const r = await rest(`profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ id: user.id, hide_bible_topic: body.hideBibleTopic, email: user.email, updated_at: new Date().toISOString() }])
      });
      if (!r.ok) return res.status(502).json({ error: "save failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ ok: true });
    }

    // role / level (onboarding) — also stamps email so the admin view has
    // it, and profiles.name from the account's own signup (user_metadata),
    // mirroring how createChild/createClassStudent already store a name —
    // so an adult's own self-signup shows up by name too, not just kids
    // and class students created by someone else.
    const { role, level } = body;
    if (role !== "teacher" && role !== "student" && role !== "parent") return res.status(400).json({ error: "role must be teacher, student, or parent" });
    const metaName = user.user_metadata && user.user_metadata.name;
    const row = { id: user.id, role, level: level || null, email: user.email, updated_at: new Date().toISOString() };
    if (metaName) row.name = String(metaName).slice(0, 60);
    const r = await rest(`profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([row])
    });
    if (!r.ok) return res.status(502).json({ error: "save failed", detail: (await r.text()).slice(0, 300) });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

// per-student progress summary { totalSeconds, streak, lessons, lastActive }
// for a list of user ids — reused by the teacher class/student views.
async function progressFor(rest, ids) {
  const out = {};
  ids.forEach(id => { out[id] = { totalSeconds: 0, streak: 0, lessons: 0, lastActive: null }; });
  if (!ids.length) return out;
  const inList = ids.map(encodeURIComponent).join(",");
  const [dr, pr] = await Promise.all([
    rest(`practice_days?user_id=in.(${inList})&select=user_id,day,seconds`),
    rest(`practice_progress?user_id=in.(${inList})&select=user_id,lesson_id`)
  ]);
  const days = dr.ok ? await dr.json() : [];
  const prog = pr.ok ? await pr.json() : [];
  const byUser = {}, lessonsByUser = {};
  days.forEach(d => { (byUser[d.user_id] = byUser[d.user_id] || []).push(d); });
  prog.forEach(p => { (lessonsByUser[p.user_id] = lessonsByUser[p.user_id] || new Set()).add(p.lesson_id); });
  ids.forEach(id => {
    const ud = byUser[id] || [];
    const practiced = ud.filter(r => (r.seconds || 0) > 0);
    const daySet = new Set(practiced.map(r => r.day));
    out[id] = {
      totalSeconds: ud.reduce((s, r) => s + (r.seconds || 0), 0),
      streak: streakFromDays(daySet),
      lessons: (lessonsByUser[id] || new Set()).size,
      lastActive: practiced.length ? practiced.map(r => r.day).sort().slice(-1)[0] : null
    };
  });
  return out;
}

// a class's assigned lessons, each with how many of its students have
// started it (>=1 submission) — used by the teacher's class view.
async function assignmentsFor(rest, classId, studentIds) {
  const ar = await rest(`assignments?class_id=eq.${encodeURIComponent(classId)}&select=id,lesson_id,created_at&order=created_at.desc`);
  const rows = ar.ok ? await ar.json() : [];
  if (!rows.length) return [];
  const ids = rows.map(a => a.id);
  const sr = await rest(`submissions?assignment_id=in.(${ids.join(",")})&select=assignment_id,student_id`);
  const subs = sr.ok ? await sr.json() : [];
  const doneByAssignment = {};
  subs.forEach(s => { (doneByAssignment[s.assignment_id] = doneByAssignment[s.assignment_id] || new Set()).add(s.student_id); });
  return rows.map(a => ({
    id: a.id, lessonId: a.lesson_id, created: a.created_at,
    done: (doneByAssignment[a.id] || new Set()).size, total: studentIds.length
  }));
}

// one student's homework for their class: every assignment, plus that
// student's own submissions per assignment (empty array = not started).
async function homeworkFor(rest, classId, studentId) {
  const ar = await rest(`assignments?class_id=eq.${encodeURIComponent(classId)}&select=id,lesson_id,created_at&order=created_at.desc`);
  const rows = ar.ok ? await ar.json() : [];
  if (!rows.length) return [];
  const ids = rows.map(a => a.id);
  const sr = await rest(`submissions?assignment_id=in.(${ids.join(",")})&student_id=eq.${encodeURIComponent(studentId)}&select=assignment_id,activity,score,max,seconds,created_at&order=created_at.asc`);
  const subs = sr.ok ? await sr.json() : [];
  const byAssignment = {};
  subs.forEach(s => { (byAssignment[s.assignment_id] = byAssignment[s.assignment_id] || []).push({
    activity: s.activity, score: s.score, max: s.max, seconds: s.seconds, created: s.created_at
  }); });
  // a lesson-wide total: every graded activity for this assignment added
  // together — Comprehension, Let's Talk, the whole-session recordings,
  // Word Scramble, and the in-lesson games all land in `submissions` the
  // same way, so summing whatever has a real score/max covers all of
  // them without needing activity-specific logic. A bare "Talk with AI"
  // turn (which logs with no score) doesn't count either way.
  return rows.map(a => {
    const items = byAssignment[a.id] || [];
    const graded = items.filter(x => x.score != null && x.max != null);
    const total = graded.length ? { sum: graded.reduce((s, x) => s + x.score, 0), max: graded.reduce((s, x) => s + x.max, 0) } : null;
    return { id: a.id, lessonId: a.lesson_id, created: a.created_at, submissions: items, total };
  });
}

// true only if `childId` is a child profile whose parent_id is `parentId`
async function childOwnedBy(rest, childId, parentId) {
  if (!childId) return false;
  const vr = await rest(`profiles?id=eq.${encodeURIComponent(childId)}&select=parent_id`);
  if (!vr.ok) return false;
  const rows = await vr.json();
  return !!(rows && rows[0] && rows[0].parent_id === parentId);
}

// true only if `studentId` is a profile whose teacher_id is `teacherId`
async function studentOwnedBy(rest, studentId, teacherId) {
  if (!studentId) return false;
  const vr = await rest(`profiles?id=eq.${encodeURIComponent(studentId)}&select=teacher_id`);
  if (!vr.ok) return false;
  const rows = await vr.json();
  return !!(rows && rows[0] && rows[0].teacher_id === teacherId);
}

// unambiguous code alphabet (no 0/O/1/I) so codes are easy to read aloud
function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// cancels every active Stripe subscription for a customer id (best-effort —
// used by both the dedicated "cancel subscription" admin action and before
// deleting an account, so nobody keeps being billed with no login left).
// Returns how many subscriptions it canceled.
async function cancelStripeSubscriptions(customerId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !customerId) return 0;
  const lr = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=10`, {
    headers: { Authorization: "Bearer " + key }
  });
  if (!lr.ok) return 0;
  const list = await lr.json();
  const subs = (list && list.data) || [];
  let canceled = 0;
  for (const sub of subs) {
    const dr = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, { method: "DELETE", headers: { Authorization: "Bearer " + key } });
    if (dr.ok) canceled++;
  }
  return canceled;
}

async function adminData(res, owner, svc, rest) {
  // students = every auth user except the owner. Emails come from the auth
  // admin API (reliable), everything else is joined in from our tables.
  const au = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=500`, { headers: svc });
  if (!au.ok) return res.status(502).json({ error: "user list failed", detail: (await au.text()).slice(0, 200) });
  const auJson = await au.json();
  const authUsers = Array.isArray(auJson) ? auJson : (auJson.users || []);

  const [profR, daysR, progR] = await Promise.all([
    rest(`profiles?select=id,name,role,level,teacher_id,invite_code,live_voice_beta`),
    rest(`practice_days?select=user_id,day,seconds`),
    rest(`practice_progress?select=user_id,lesson_id`)
  ]);
  const profiles = profR.ok ? await profR.json() : [];
  const days = daysR.ok ? await daysR.json() : [];
  const progress = progR.ok ? await progR.json() : [];

  const profById = {};
  profiles.forEach(p => { profById[p.id] = p; });
  const ownerCode = (profById[owner.id] || {}).invite_code || null;

  const daysByUser = {};
  days.forEach(d => { (daysByUser[d.user_id] = daysByUser[d.user_id] || []).push(d); });
  const lessonsByUser = {};
  progress.forEach(p => { (lessonsByUser[p.user_id] = lessonsByUser[p.user_id] || new Set()).add(p.lesson_id); });

  const now = Date.now();
  const WEEK = 7 * 24 * 3600 * 1000;
  const students = [];
  let mine = 0, activeThisWeek = 0;

  authUsers.forEach(u => {
    if ((u.email || "").toLowerCase() === OWNER_EMAIL) return; // never list the owner
    const prof = profById[u.id] || {};
    const ud = daysByUser[u.id] || [];
    const totalSeconds = ud.reduce((s, r) => s + (r.seconds || 0), 0);
    const practiced = ud.filter(r => (r.seconds || 0) > 0);
    const daySet = new Set(practiced.map(r => r.day));
    const lastPracticeDay = practiced.length ? practiced.map(r => r.day).sort().slice(-1)[0] : null;
    const lastActive = lastPracticeDay || (u.last_sign_in_at ? u.last_sign_in_at.slice(0, 10) : null);
    const isMine = prof.teacher_id === owner.id;
    if (isMine) mine++;
    if (lastActive && (now - new Date(lastActive + "T00:00:00Z").getTime()) < WEEK) activeThisWeek++;
    students.push({
      id: u.id,
      name: prof.name || (u.user_metadata && u.user_metadata.name) || null,
      email: u.email || "(no email)",
      role: prof.role || null,
      level: prof.level || null,
      mine: isMine,
      totalSeconds,
      lastActive,
      streak: streakFromDays(daySet),
      lessons: (lessonsByUser[u.id] || new Set()).size,
      joined: u.created_at ? u.created_at.slice(0, 10) : null,
      liveVoiceAccess: !!prof.live_voice_beta
    });
  });

  // most recently active first
  students.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));

  return res.status(200).json({
    ok: true,
    ownerInvite: ownerCode,
    summary: { total: students.length, mine, activeThisWeek },
    students
  });
}
