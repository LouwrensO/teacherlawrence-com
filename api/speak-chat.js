// /api/speak-chat.js — three modes of AI speaking practice, sharing one
// auth/access/moderation/rate-limit scaffold (this project is pinned at
// Vercel Hobby's 12-function cap, so related concerns share a file):
//
//   default (no `mode`, or mode:'chat') — "Talk with AI" (Step 9): one turn
//     of free conversation. Student's transcribed/typed line in, a short
//     spoken-style AI reply out. Mirrors api/generate.js's shape, but the
//     reply is plain conversational text, not a JSON lesson object.
//
//   mode:'score' — "Speaking Homework" (Step 10): given one of the lesson's
//     own discussion questions and the student's transcribed spoken answer,
//     returns a content/fluency score (grammar, vocabulary, how well it
//     answers the question — NOT pronunciation/accent, which isn't
//     recoverable once the audio has become text) plus a short feedback
//     note, and logs {score, max, ai_feedback} to `submissions` so the
//     teacher can see it without a KakaoTalk voice memo.
//
//   mode:'session' — Step 8's optional whole-session recording: given the
//     full list of a lesson's words/sentences/questions and everything
//     speech-recognition picked up continuously across the WHOLE practice
//     queue, returns ONE overall completion/effort score + praise (again,
//     text-only — not pronunciation) instead of scoring turn by turn.
//
//   mode:'live-token' — TEST-PHASE ONLY, gated by LIVE_TEST_ALLOWLIST
//     (./_liveVoiceAllowlist.js) OR profiles.live_voice_beta (per-student,
//     toggled from the owner-only /admin-voice page). Mints a short-lived
//     Gemini Live ephemeral token so the browser can open a direct WebSocket
//     to Google for true low-latency voice-to-voice ("Live Voice (Beta)"),
//     instead of this file's turn-based chat. Not the production version —
//     see CLAUDE.md for the plan to harden this (per-student daily minute
//     cap, moving off the free tier, removing the gate) before it's offered
//     to every student.
//
//   mode:'live-review' — same idea as mode:'session' above, but for a
//     Live Voice (Beta) conversation: once the session ends, the client
//     sends the two-sided text transcript Gemini Live streamed alongside
//     the audio (this server never sees the audio itself) and gets back
//     one overall engagement/effort score + praise, logged the same way.
import { dsChatJSON, fetchWithRetry, DEEPSEEK_URL } from "./_ds.js";
import { isLiveVoiceAllowed } from "./_liveVoiceAllowlist.js";

const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";
const PUBLISHABLE  = "sb_publishable_YBAbltikDkK6ag5PAjTJXg_99i6Yow8";

// Gemini Live model for the voice-to-voice test — verify this is still a
// current, available Live-API model name in Google AI Studio before
// testing, model names/versions on the Live API move fast.
const GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

// Turns/answers per day, shared across both modes: generous enough for a
// real practice session, low enough that a scripted loop can't run up the
// DeepSeek bill. Paid (not just trialing or a free class student) accounts
// get more room, same idea as generate.js's daily lesson cap.
const DAILY_LIMIT_TRIAL = 40;
const DAILY_LIMIT_PAID  = 120;

// Keep the same conservative first-line keyword screen as generate.js —
// this endpoint is fed free-form student speech, so it needs the same
// guardrail before anything reaches the LLM.
const BLOCKED_PATTERNS = [
  /suicid/i, /self[\s-]?harm/i, /self[\s-]?injur/i,
  /kill (myself|yourself|himself|herself|themselves)/i,
  /\bporn(ograph\w*)?\b/i, /\bexplicit sex/i, /\brape\b/i,
  /child (sexual|abuse|porn)/i, /\bcsam\b/i,
  /how to (make|build) an? (bomb|weapon|gun|explosive)/i,
  /\bterroris/i, /\bdrug[\s-]?manufactur/i, /how to (make|cook) meth/i
];
function blockedByKeywords(text) {
  return BLOCKED_PATTERNS.some(re => re.test(text || ""));
}

// Same cheap LLM classifier as generate.js, tuned for a one-line spoken
// message instead of a lesson topic. Fails OPEN on error — the keyword
// check above is the hard backstop.
async function moderateMessage(text, dsKey) {
  if (!dsKey || !text) return { allowed: true };
  const result = await dsChatJSON(dsKey, {
    system:
      "You are a content-safety classifier for an ESL speaking-practice feature used by students of all ages. " +
      "Reply with ONLY valid JSON: {\"allowed\": true or false, \"reason\": \"short reason\"}. " +
      "Block messages about self-harm, suicide, sexual content, extreme/graphic violence, or illegal activity " +
      "(weapons, drugs, terrorism). Allow ordinary conversation, including clumsy or broken English, " +
      "off-topic small talk, and questions or answers about any everyday, academic, or professional subject. " +
      "When in doubt, allow it.",
    user: "Student's message:\n\n" + String(text).slice(0, 1000),
    temperature: 0
  });
  if (!result.ok) return { allowed: true }; // fails OPEN — the keyword check is the hard backstop
  return { allowed: result.data.allowed !== false, reason: result.data.reason || "" };
}

const LEVEL_GUIDE = {
  beginner:     "Use very short, simple sentences and common everyday words (CEFR A1-A2).",
  intermediate: "Use clear, natural sentences (CEFR B1). A few less-common words are fine.",
  advanced:     "Use natural, idiomatic English (CEFR B2). Don't over-simplify."
};

// Shared by the turn-based "Talk with AI" chat (DeepSeek) and the Live
// Voice test (Gemini Live) — same lesson-aware ESL conversation partner
// persona either way, just a different model underneath.
function buildConversationSystemPrompt(context, levelGuide) {
  const ctx = context || {};
  const vocabWords = Array.isArray(ctx.vocab) ? ctx.vocab.map(v => v && v.w).filter(Boolean).slice(0, 10) : [];
  const discussion = Array.isArray(ctx.discussion) ? ctx.discussion.slice(0, 5) : [];
  return (
    "You are a friendly, patient English conversation partner helping an ESL student practice SPOKEN English. " +
    `${levelGuide} ` +
    "Keep every reply short — 1 to 3 sentences, like something you'd actually say out loud, never a written essay. " +
    "End almost every reply with one natural follow-up question to keep the conversation going. " +
    "If the student makes a grammar or word-choice mistake, you may gently model the correct form in your reply " +
    "(e.g. by naturally using the corrected phrase), but don't lecture or list corrections — stay in conversation. " +
    "Your students are Korean speakers. If a student explicitly asks you to explain in Korean, or clearly says " +
    "they don't understand your question, briefly clarify what you meant in ONE short Korean sentence, then " +
    "immediately continue the conversation in English (repeat or simplify your question). Never keep speaking " +
    "Korean beyond that one clarifying sentence, and don't switch to Korean for any other reason — the point is " +
    "to unblock a confused student for a moment, not to stop practicing English. " +
    "Reply in plain text only, no markdown, no JSON.\n\n" +
    (ctx.title ? `Lesson topic: "${ctx.title}"${ctx.topic ? ` (${ctx.topic})` : ""}.\n` : "") +
    (vocabWords.length ? `Vocabulary the student just studied, weave these in naturally if it fits: ${vocabWords.join(", ")}.\n` : "") +
    (discussion.length ? `Discussion questions from the lesson you can draw on: ${discussion.join(" | ")}\n` : "")
  );
}

// best-effort: does this student's class have this lesson assigned as
// homework? Returns the assignment id, or null (not in a class, or the
// lesson isn't assigned) — Speaking Homework logs either way, this is
// just so it shows up bundled with a formal assignment when there is one.
async function findAssignmentId(secret, studentId, lessonId) {
  try {
    const headers = { apikey: secret, Authorization: "Bearer " + secret };
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${studentId}&select=class_id`, { headers });
    const prows = await pr.json();
    const classId = Array.isArray(prows) && prows[0] && prows[0].class_id;
    if (!classId) return null;
    const ar = await fetch(
      `${SUPABASE_URL}/rest/v1/assignments?class_id=eq.${classId}&lesson_id=eq.${encodeURIComponent(lessonId)}&select=id`,
      { headers }
    );
    const arows = await ar.json();
    return (Array.isArray(arows) && arows[0]) ? arows[0].id : null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      mode, lessonId, context, history, message, question, transcript,
      expectedItems, secondsSpent, itemsAttempted, itemsTotal,
      modelAnswer, answer
    } = req.body || {};
    const isScore = mode === "score";
    const isSession = mode === "session";
    const isWritten = mode === "written";
    const isLiveToken = mode === "live-token";
    const isLiveReview = mode === "live-review";
    const inputText = (isScore || isSession || isLiveReview) ? String(transcript || "") : (isWritten ? String(answer || "") : String(message || ""));
    if (!isLiveToken && !inputText.trim()) {
      return res.status(400).json({ error: isWritten ? "answer required" : (isScore || isSession || isLiveReview) ? "transcript required" : "message required" });
    }
    if ((isScore || isWritten) && !String(question || "").trim()) {
      return res.status(400).json({ error: "question required" });
    }
    if (isSession && (!Array.isArray(expectedItems) || !expectedItems.length)) {
      return res.status(400).json({ error: "expectedItems required" });
    }

    // ---- who is this? require a real, logged-in account ----
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Please log in to practice speaking." });
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
    });
    if (!ur.ok) return res.status(401).json({ error: "Your session has expired — please log in again." });
    const user = await ur.json();

    // ---- do they actually have access (trial or subscribed)? ----
    // Queries Supabase directly (same fields api/access.js itself reads)
    // instead of making an HTTP call back into this same deployment's
    // /api/access — that kind of internal self-fetch can get silently
    // blocked (e.g. by Vercel's preview-deployment protection), which
    // fails closed and denies access even to genuinely subscribed accounts.
    const secret = process.env.SUPABASE_SECRET_KEY;
    let acc = { subscribed: false, trialing: false, classStudent: false, level: null, liveVoiceBeta: false };
    if (secret) {
      try {
        const pr = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=subscribed,trial_ends_at,level,class_id,live_voice_beta`,
          { headers: { apikey: secret, Authorization: "Bearer " + secret } }
        );
        if (pr.ok) {
          const rows = await pr.json();
          const row = rows && rows[0];
          if (row) {
            const subscribed = !!row.subscribed;
            const trialing = !subscribed && !!row.trial_ends_at && new Date(row.trial_ends_at) > new Date();
            const classStudent = !!row.class_id;
            acc = { subscribed: subscribed || trialing || classStudent, trialing, classStudent, level: row.level || null, liveVoiceBeta: !!row.live_voice_beta };
          }
        }
      } catch (e) { /* fail closed below — acc.subscribed stays false */ }
    }
    if (!acc.subscribed) {
      return res.status(403).json({ error: "Speaking practice is a trial/member feature — start your free trial to use it." });
    }

    if (isLiveToken) {
      // ---- Live Voice (Beta), TEST PHASE ONLY — see the allowlist/model
      // constants and header comment above for what's still hardened later.
      // Two ways in: the hardcoded seed list (_liveVoiceAllowlist.js), or
      // profiles.live_voice_beta (toggled per-student from the owner-only
      // /admin-voice page).
      if (!isLiveVoiceAllowed(user.email, acc.liveVoiceBeta)) {
        return res.status(403).json({ error: "Live Voice is a limited beta test right now." });
      }
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel" });

      const systemPrompt = buildConversationSystemPrompt(context, LEVEL_GUIDE[acc.level] || LEVEL_GUIDE.intermediate);

      // Single-use, short-lived token: the client has 1 minute to open a
      // session with it and the session itself expires after 15 (Google's
      // own Live-API session ceiling anyway). This is the token-safety
      // pattern confirmed against Google's own reference implementation;
      // the stronger liveConnectConstraints token-level lock (baking model/
      // system-instruction into the token itself) is documented but its
      // exact REST field names couldn't be verified against the live docs
      // this session — worth confirming before this leaves the test group.
      const now = Date.now();
      let gr;
      try {
        gr = await fetch(`https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${geminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uses: 1,
            expireTime: new Date(now + 15 * 60 * 1000).toISOString(),
            newSessionExpireTime: new Date(now + 60 * 1000).toISOString()
          })
        });
      } catch (e) {
        return res.status(502).json({ error: "Could not reach Google to start a Live Voice session." });
      }
      // TEMP: surface Google's actual error text while this beta is being
      // debugged (safe — this is only error detail, never the API key).
      // Remove this detail field once the endpoint/shape is confirmed working.
      if (!gr.ok) {
        const bodyText = (await gr.text().catch(() => "")).trim();
        const detail = `HTTP ${gr.status} ${gr.statusText || ""} from Google — body: ${bodyText || "(empty)"}`;
        return res.status(502).json({ error: "Could not start a Live Voice session right now.", detail: detail.slice(0, 600) });
      }
      const gj = await gr.json();
      const liveToken = gj && gj.name;
      if (!liveToken) {
        return res.status(502).json({ error: "Could not start a Live Voice session right now.", detail: JSON.stringify(gj).slice(0, 500) });
      }
      return res.status(200).json({ token: liveToken, model: GEMINI_LIVE_MODEL, systemInstruction: systemPrompt });
    }

    // ---- content safety on the student's message/answer ----
    // session/live-review mode's transcript covers a whole multi-minute
    // practice, so it gets a much larger cap than a single chat turn or
    // homework answer
    const messageText = inputText.slice(0, (isSession || isLiveReview) ? 4000 : 1000);
    if (blockedByKeywords(messageText)) {
      return res.status(400).json({ error: "Let's talk about something else." });
    }
    const dsKey = process.env.DEEPSEEK_API_KEY;
    const modResult = await moderateMessage(messageText, dsKey);
    if (!modResult.allowed) {
      return res.status(400).json({ error: "Let's talk about something else." });
    }

    // ---- rate limit: how many speaking turns/written answers has this account had today? ----
    // counts 'speaking' AND 'comprehension' together so alternating between
    // the two modes can't double a student's effective daily budget
    if (secret) {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const cr = await fetch(
          `${SUPABASE_URL}/rest/v1/submissions?student_id=eq.${user.id}&activity=in.(speaking,comprehension)&created_at=gte.${since}&select=id`,
          { headers: { apikey: secret, Authorization: "Bearer " + secret } }
        );
        if (cr.ok) {
          const rows = await cr.json();
          const isPaid = acc.subscribed && !acc.trialing && !acc.classStudent;
          const limit = isPaid ? DAILY_LIMIT_PAID : DAILY_LIMIT_TRIAL;
          if (Array.isArray(rows) && rows.length >= limit) {
            return res.status(429).json({ error: `You've reached today's limit of ${limit} speaking/writing turns. Try again tomorrow.` });
          }
        }
      } catch (e) { /* if the count check fails, don't block a legitimate user over it */ }
    }

    if (!dsKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not set in Vercel" });

    const levelGuide = LEVEL_GUIDE[acc.level] || LEVEL_GUIDE.intermediate;

    if (isScore) {
      // ---- Speaking Homework: score one answer to one lesson question ----
      const systemPrompt =
        "You are a friendly ESL teacher grading a student's SPOKEN answer to a discussion question, transcribed to text. " +
        `${levelGuide} ` +
        "Score 0-10 based on how well the answer addresses the question, grammar, and vocabulary use — be encouraging " +
        "and generous with a genuine, on-topic attempt. You only see text, so never judge pronunciation or accent. " +
        "Reply with ONLY valid JSON: {\"score\": 0-10 integer, \"feedback\": \"one short, encouraging sentence, " +
        "may gently note one specific grammar or word-choice improvement\"}.";
      const userPrompt = `Question: "${String(question).slice(0, 500)}"\n\nStudent's spoken answer: "${messageText}"`;

      const result = await dsChatJSON(dsKey, { system: systemPrompt, user: userPrompt, temperature: 0.3, max_tokens: 200 });
      if (!result.ok) return res.status(502).json({ error: "AI did not return a valid score" });
      const parsed = result.data;
      const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score))));
      const feedback = String(parsed.feedback || "").slice(0, 500);
      if (!Number.isFinite(score) || !feedback) {
        return res.status(502).json({ error: "AI did not return a valid score" });
      }

      // ---- log this graded answer (best-effort; never blocks the reply) ----
      if (secret) {
        try {
          const assignmentId = lessonId ? await findAssignmentId(secret, user.id, lessonId) : null;
          await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
            method: "POST",
            headers: {
              apikey: secret, Authorization: "Bearer " + secret,
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            },
            body: JSON.stringify([{
              assignment_id: assignmentId,
              student_id: user.id,
              lesson_id: lessonId || null,
              activity: "speaking",
              score, max: 10,
              ai_feedback: feedback
            }])
          });
        } catch (e) { /* logging is best-effort — the score still reaches the student even if this fails */ }
      }

      return res.status(200).json({ score, max: 10, feedback });
    }

    if (isWritten) {
      // ---- Comprehension: score one WRITTEN answer to one lesson question ----
      // Unlike mode:'score' (a transcribed spoken answer, where spelling/
      // punctuation are meaningless), this IS written text, so grammar and
      // spelling are fair to comment on. A model answer is usually
      // available (compAnswers) — weight whether the student's own-words
      // answer captures the same key content over exact phrasing.
      const modelAnswerText = String(modelAnswer || "").slice(0, 500);
      const systemPrompt =
        "You are a friendly ESL teacher grading a student's WRITTEN answer to a reading-comprehension question. " +
        `${levelGuide} ` +
        "Score 0-10 based mainly on whether the answer captures the key fact/content the question asks for — the " +
        "student may phrase it completely differently from any model answer given, in their own words, and should " +
        "be rewarded for correct content even with imperfect grammar. Grammar and spelling are secondary and, unlike " +
        "spoken answers, ARE fair to gently note since this is written text. Be encouraging and generous with a " +
        "genuine, on-topic attempt. " +
        "Reply with ONLY valid JSON: {\"score\": 0-10 integer, \"feedback\": \"one short, encouraging sentence, " +
        "may gently note one specific content or grammar/spelling improvement\"}.";
      const userPrompt =
        `Question: "${String(question).slice(0, 500)}"\n` +
        (modelAnswerText ? `Model answer (for reference only — the student's own wording is fine): "${modelAnswerText}"\n` : "") +
        `Student's written answer: "${messageText}"`;

      const result = await dsChatJSON(dsKey, { system: systemPrompt, user: userPrompt, temperature: 0.3, max_tokens: 200 });
      if (!result.ok) return res.status(502).json({ error: "AI did not return a valid score" });
      const parsed = result.data;
      const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score))));
      const feedback = String(parsed.feedback || "").slice(0, 500);
      if (!Number.isFinite(score) || !feedback) {
        return res.status(502).json({ error: "AI did not return a valid score" });
      }

      // ---- log this graded answer (best-effort; never blocks the reply) ----
      if (secret) {
        try {
          const assignmentId = lessonId ? await findAssignmentId(secret, user.id, lessonId) : null;
          await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
            method: "POST",
            headers: {
              apikey: secret, Authorization: "Bearer " + secret,
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            },
            body: JSON.stringify([{
              assignment_id: assignmentId,
              student_id: user.id,
              lesson_id: lessonId || null,
              activity: "comprehension",
              score, max: 10,
              ai_feedback: feedback
            }])
          });
        } catch (e) { /* logging is best-effort — the score still reaches the student even if this fails */ }
      }

      return res.status(200).json({ score, max: 10, feedback });
    }

    if (isSession) {
      // ---- Step 8 whole-session recording: one overall completion/effort review ----
      const items = expectedItems.map(x => String(x || "").slice(0, 200)).filter(Boolean).slice(0, 80);
      const total = Number.isFinite(Number(itemsTotal)) ? Math.round(Number(itemsTotal)) : items.length;
      const attempted = Number.isFinite(Number(itemsAttempted)) ? Math.max(0, Math.min(total, Math.round(Number(itemsAttempted)))) : total;
      const minutes = Number.isFinite(Number(secondsSpent)) ? Math.max(0, Math.round(Number(secondsSpent) / 60)) : null;

      const systemPrompt =
        "You are a warm, encouraging ESL teacher reviewing a student's speaking practice session. They read a list of " +
        "target words/sentences/questions aloud one at a time; speech-to-text recognized what it could across the WHOLE " +
        "session (it may be incomplete, out of order, or imperfect, and you only see text, so never judge pronunciation " +
        "or accent — only completion and effort). " +
        `${levelGuide} ` +
        "Reply with ONLY valid JSON: {\"score\": 0-10 integer reflecting how much of the list they covered and how much " +
        "recognizable effort came through (be generous with a genuine attempt), \"feedback\": \"one short warm paragraph " +
        "— naturally mention how long they practiced and roughly how much they covered, praise their effort, and if you " +
        "have one genuine specific suggestion offer it gently\"}.";
      const userPrompt =
        `Target words/sentences/questions (${total} total, this student reached ${attempted} of them):\n${items.join(" | ")}\n\n` +
        `What speech-to-text recognized during the session (may be partial/out of order):\n"${messageText}"\n\n` +
        (minutes != null ? `Time practiced: about ${minutes} minute${minutes === 1 ? "" : "s"}.` : "");

      const result = await dsChatJSON(dsKey, { system: systemPrompt, user: userPrompt, temperature: 0.3, max_tokens: 220 });
      if (!result.ok) return res.status(502).json({ error: "AI did not return a valid score" });
      const parsed = result.data;
      const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score))));
      const feedback = String(parsed.feedback || "").slice(0, 600);
      if (!Number.isFinite(score) || !feedback) {
        return res.status(502).json({ error: "AI did not return a valid score" });
      }

      // ---- log this session review (best-effort; never blocks the reply) ----
      if (secret) {
        try {
          const assignmentId = lessonId ? await findAssignmentId(secret, user.id, lessonId) : null;
          await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
            method: "POST",
            headers: {
              apikey: secret, Authorization: "Bearer " + secret,
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            },
            body: JSON.stringify([{
              assignment_id: assignmentId,
              student_id: user.id,
              lesson_id: lessonId || null,
              activity: "speaking",
              score, max: 10,
              seconds: Number.isFinite(Number(secondsSpent)) ? Math.round(Number(secondsSpent)) : null,
              ai_feedback: feedback
            }])
          });
        } catch (e) { /* logging is best-effort — the score still reaches the student even if this fails */ }
      }

      return res.status(200).json({ score, max: 10, feedback });
    }

    if (isLiveReview) {
      // ---- Live Voice (Beta): one overall review of a free spoken
      // conversation with the AI partner, once the session ends. Same
      // idea as mode:'session' above but for an open back-and-forth
      // conversation rather than a fixed list of words/sentences/
      // questions to cover — the client builds `transcript` from both
      // sides of the conversation (Gemini Live streams a text transcript
      // of what it and the student each said, even though the audio
      // itself never touches this server).
      const minutes = Number.isFinite(Number(secondsSpent)) ? Math.max(0, Math.round(Number(secondsSpent) / 60)) : null;
      const systemPrompt =
        "You are a warm, encouraging ESL teacher reviewing a transcript of a student's live spoken conversation " +
        "practice with an AI partner, about a lesson topic. You only see text (both sides of the conversation), so " +
        "never judge pronunciation or accent — only how much they engaged, how on-topic their answers were, and " +
        "general effort. " +
        `${levelGuide} ` +
        "Reply with ONLY valid JSON: {\"score\": 0-10 integer reflecting engagement and effort (be generous with a " +
        "genuine attempt), \"feedback\": \"one short warm paragraph — naturally mention how long they practiced, " +
        "praise their effort, and if you have one genuine specific suggestion offer it gently\"}.";
      const userPrompt =
        `Conversation transcript (both the student and the AI partner):\n"${messageText}"\n\n` +
        (minutes != null ? `Time spent: about ${minutes} minute${minutes === 1 ? "" : "s"}.` : "");

      const result = await dsChatJSON(dsKey, { system: systemPrompt, user: userPrompt, temperature: 0.3, max_tokens: 220 });
      if (!result.ok) return res.status(502).json({ error: "AI did not return a valid score" });
      const parsed = result.data;
      const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score))));
      const feedback = String(parsed.feedback || "").slice(0, 600);
      if (!Number.isFinite(score) || !feedback) {
        return res.status(502).json({ error: "AI did not return a valid score" });
      }

      if (secret) {
        try {
          const assignmentId = lessonId ? await findAssignmentId(secret, user.id, lessonId) : null;
          await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
            method: "POST",
            headers: {
              apikey: secret, Authorization: "Bearer " + secret,
              "Content-Type": "application/json",
              Prefer: "return=minimal"
            },
            body: JSON.stringify([{
              assignment_id: assignmentId,
              student_id: user.id,
              lesson_id: lessonId || null,
              activity: "speaking",
              score, max: 10,
              seconds: Number.isFinite(Number(secondsSpent)) ? Math.round(Number(secondsSpent)) : null,
              ai_feedback: feedback
            }])
          });
        } catch (e) { /* logging is best-effort — the score still reaches the student even if this fails */ }
      }

      return res.status(200).json({ score, max: 10, feedback });
    }

    // ---- Talk with AI: one turn of free conversation ----
    const systemPrompt = buildConversationSystemPrompt(context, levelGuide);
    const priorTurns = Array.isArray(history) ? history.slice(-12) : [];
    const messages = [
      { role: "system", content: systemPrompt },
      ...priorTurns
        .filter(h => h && h.text && (h.role === "user" || h.role === "assistant"))
        .map(h => ({ role: h.role, content: String(h.text).slice(0, 1000) })),
      { role: "user", content: messageText }
    ];

    let dsResp;
    try {
      dsResp = await fetchWithRetry(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + dsKey },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          temperature: 0.7,
          max_tokens: 220,
          stream: true
        })
      });
    } catch (e) {
      return res.status(502).json({ error: "AI did not return a reply" });
    }
    if (!dsResp.ok || !dsResp.body) {
      return res.status(502).json({ error: "AI did not return a reply" });
    }

    // ---- stream the reply through as plain text (not one JSON blob) so the
    // browser can start speaking the first sentence before the rest of the
    // reply has even finished generating, instead of waiting for it all ----
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    const reader = dsResp.body.getReader();
    const decoder = new TextDecoder();
    let full = "", buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          const delta = evt?.choices?.[0]?.delta?.content || "";
          if (delta) { full += delta; res.write(delta); }
        } catch (e) { /* ignore a malformed/partial SSE line */ }
      }
    }
    full = full.trim();

    // ---- log this turn (best-effort; never blocks the reply) ----
    if (full && secret) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/submissions`, {
          method: "POST",
          headers: {
            apikey: secret, Authorization: "Bearer " + secret,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify([{
            student_id: user.id,
            lesson_id: lessonId || null,
            activity: "speaking"
          }])
        });
      } catch (e) { /* logging is best-effort — the reply already went out even if this fails */ }
    }

    return res.end();
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
}
