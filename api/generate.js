// /api/generate.js
// This runs ON THE SERVER (Vercel), never in the browser.
// Your DeepSeek API key lives in a Vercel Environment Variable called
// DEEPSEEK_API_KEY and is never sent to the user's phone or computer.

import { fetchUnsplashPhoto } from "./_unsplash.js";
import { dsChatJSON } from "./_ds.js";

const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";
const PUBLISHABLE  = "sb_publishable_YBAbltikDkK6ag5PAjTJXg_99i6Yow8";

// Custom lessons created per day: enough for a real class to make a handful
// of one-off lessons, low enough that scripting the endpoint isn't a cheap
// way to run up the DeepSeek/Claude bill. Actually-paying subscribers (not
// just trialing or a free class student) get a bit more room.
const DAILY_LIMIT_TRIAL = 5;
const DAILY_LIMIT_PAID  = 10;

// TEMPORARY test-phase gate for uploading a PDF/long document (client-side
// extracted text arrives here the same way a pasted article does, flagged
// with `viaPdf:true` — see public/create.html). This is a bigger, newer
// capability (the project's first multi-call generation flow and first
// client-side PDF-parsing dependency) than ordinary topic/paste lessons,
// so it starts allowlisted, same pattern as api/speak-chat.js's
// LIVE_TEST_ALLOWLIST for the Live Voice beta — widen once a handful of
// real documents have gone through it cleanly.
const PDF_UPLOAD_ALLOWLIST = [
  "louwrensoberholzer@gmail.com"
];

// The AI is asked for multiple-choice comprehension questions
// ({q,options,correct}), but its JSON isn't guaranteed well-formed —
// missing options, a correct index out of range, etc. Any entry that
// doesn't clearly qualify falls back to a plain question string instead,
// which public/lesson.html already renders as the older typed+AI-scored
// flow (see compQuestionHtml()/talkQuestionHtml()) — degrades gracefully
// rather than shipping a broken multiple-choice question. Never drops an
// entry (keeps comprehension/compAnswers index-aligned). Also applied to
// discussion (Let's Talk) for the same graceful-degradation reason, even
// though discussion is no longer PROMPTED as multiple-choice — a lesson
// generated before that changed, or one run through the now-retired
// upgrade-discussion.html tool, can still have {q,options,correct}
// entries there, and this keeps rendering them correctly either way.
function sanitizeChoiceQuestions(list) {
  return (Array.isArray(list) ? list : []).map(item => {
    if (item && typeof item === "object" && typeof item.q === "string" &&
        Array.isArray(item.options) && item.options.length >= 2 &&
        item.options.every(o => typeof o === "string" && o.trim()) &&
        Number.isInteger(item.correct) && item.correct >= 0 && item.correct < item.options.length) {
      return { q: item.q, options: item.options, correct: item.correct };
    }
    if (item && typeof item === "object" && typeof item.q === "string") return item.q;
    return typeof item === "string" ? item : "";
  });
}

function slug(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// Fast, cheap first line of defense: obviously unsafe requests never even
// reach the moderation LLM call. Deliberately narrow (self-harm, sexual
// content, extreme violence/weapons, illegal activity) so it doesn't catch
// ordinary niche/professional topics — the LLM layer below handles nuance.
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

// Second, smarter line of defense: a cheap LLM classifier call for anything
// the keyword list misses (disguised or nuanced requests). Fails OPEN if
// the call itself errors (network hiccup, key missing) — the keyword check
// above is the hard backstop, this is a refinement on top of it.
async function moderateTopic(text, dsKey) {
  if (!dsKey || !text) return { allowed: true };
  const result = await dsChatJSON(dsKey, {
    system:
      "You are a content-safety classifier for an ESL classroom lesson generator used by students of all ages. " +
      "Reply with ONLY valid JSON: {\"allowed\": true or false, \"reason\": \"short reason\"}. " +
      "Block requests about self-harm, suicide, sexual content, extreme/graphic violence, or illegal activity " +
      "(weapons, drugs, terrorism). Allow ordinary, professional, academic, or niche educational topics " +
      "(e.g. legal English, medical English, business English, history, science) even if unusual — those are " +
      "legitimate lesson requests. When in doubt about an ordinary educational topic, allow it.",
    user: "Lesson request:\n\n" + String(text).slice(0, 2000),
    temperature: 0
  });
  if (!result.ok) return { allowed: true }; // fails OPEN — the keyword check is the hard backstop
  return { allowed: result.data.allowed !== false, reason: result.data.reason || "" };
}

export default async function handler(req, res) {
  // only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, level, topic, article, engine, visibility, partIndex, partTotal, seriesTitle, viaPdf } = req.body || {};
    const isPart = Number.isFinite(Number(partIndex)) && Number(partIndex) > 0;
    const partN = isPart ? Math.round(Number(partIndex)) : null;
    const partOf = isPart && Number.isFinite(Number(partTotal)) ? Math.round(Number(partTotal)) : null;

    // ---- who is this? require a real, logged-in account ----
    // Anonymous requests used to be allowed straight through to the AI —
    // that's both an open cost (anyone can burn API credits) and a safety
    // gap (no way to rate-limit or attribute abuse to an account).
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Please log in to create a lesson." });
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
    });
    if (!ur.ok) return res.status(401).json({ error: "Your session has expired — please log in again." });
    const user = await ur.json();

    // ---- do they actually have access (trial or subscribed)? ----
    // Reuses /api/access (rather than re-querying profiles/trial logic
    // here) so this endpoint always agrees with the rest of the site about
    // who currently has access, including trial provisioning for brand-new
    // accounts and free access for class students.
    let acc = { subscribed: false, trialing: false, classStudent: false };
    try {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const accRes = await fetch(`${proto}://${req.headers.host}/api/access`, {
        headers: { Authorization: "Bearer " + token }
      });
      if (accRes.ok) acc = await accRes.json();
    } catch (e) { /* fail closed below — acc.subscribed stays false */ }
    if (!acc.subscribed) {
      return res.status(403).json({ error: "Create Your Own is a trial/member feature — start your free trial to use it." });
    }
    if (viaPdf && !PDF_UPLOAD_ALLOWLIST.includes(String(user.email || "").toLowerCase())) {
      return res.status(403).json({ error: "PDF/document upload is a limited beta test right now." });
    }

    // ---- content safety ----
    const requestText = mode === "paste" ? (article || "") : (topic || "");
    if (blockedByKeywords(requestText)) {
      return res.status(400).json({ error: "That topic isn't allowed on this classroom site. Please try a different topic." });
    }
    const dsKeyForModeration = process.env.DEEPSEEK_API_KEY;
    const modResult = await moderateTopic(requestText, dsKeyForModeration);
    if (!modResult.allowed) {
      return res.status(400).json({ error: "That topic isn't allowed on this classroom site. Please try a different topic." });
    }

    // ---- rate limit: how many has this account made in the last 24h? ----
    // Parts 2+ of a multi-part PDF/document series skip this — part 1
    // already passed the check, and a 6-part upload shouldn't cost 6 of
    // the account's daily lessons (nor fail partway through a series
    // because the earlier parts in it used up the quota).
    const secretForLimit = process.env.SUPABASE_SECRET_KEY;
    if (secretForLimit && !(isPart && partN > 1)) {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const cr = await fetch(
          `${SUPABASE_URL}/rest/v1/lessons?created_by=eq.${user.id}&created_at=gte.${since}&select=id`,
          { headers: { apikey: secretForLimit, Authorization: "Bearer " + secretForLimit } }
        );
        if (cr.ok) {
          const rows = await cr.json();
          // "actually paying" (not just trialing or a free class student) gets the higher limit
          const isPaid = acc.subscribed && !acc.trialing && !acc.classStudent;
          const limit = isPaid ? DAILY_LIMIT_PAID : DAILY_LIMIT_TRIAL;
          if (Array.isArray(rows) && rows.length >= limit) {
            return res.status(429).json({ error: `You've reached today's limit of ${limit} custom lessons. Try again tomorrow.` });
          }
        }
      } catch (e) { /* if the count check fails, don't block a legitimate user over it */ }
    }

    // Build the instruction for the AI. We ask it to return STRICT JSON
    // so the website can turn it into a lesson reliably.
    const levelGuide = {
      easy:   "CEFR A2 (beginner). Short, simple sentences. ~250 words. 6 vocabulary words. 3 comprehension and 3 discussion questions.",
      medium: "CEFR B1 (intermediate). Clear sentences. ~450 words. 8 vocabulary words. 5 comprehension and 5 discussion questions.",
      hard:   "CEFR B2 (advanced). Rich but clear language. ~600 words. 8 vocabulary words. 5 comprehension and 5 discussion questions."
    }[level] || "CEFR B1.";

    // A single paste is capped at 6,000 characters (roughly 1,000-1,200
    // words) before it ever reaches the AI — anything longer is silently
    // cut off. That's fine for a multi-part upload (public/create.html
    // splits a long document into ~4,500-char chunks client-side before
    // sending each one here as its own request), but a plain one-shot
    // paste over the cap loses content with no warning unless we flag it
    // — `truncated` below is surfaced back to the client for exactly that.
    const rawArticle = (mode === "paste" && article) ? String(article) : "";
    const truncated = rawArticle.length > 6000;
    const partContext = (isPart && partOf && partOf > 1)
      ? ` This is part ${partN} of ${partOf} of a longer document ("${String(seriesTitle || topic || "").slice(0, 150)}") split into several lessons — write a self-contained lesson from just THIS excerpt (don't reference other parts).`
      : "";
    const source = rawArticle
      ? `Base the lesson on the FACTS in this article excerpt, but write the lesson text in your OWN ORIGINAL words (never copy sentences):${partContext}\n\n"""${rawArticle.slice(0, 6000)}"""`
      : `Write an original, uplifting, classroom-safe article about this topic: "${topic}". Prefer positive themes: science, discovery, nature, human kindness, interesting facts. No violence, politics, tragedy, or anything unsuitable for a classroom.`;

    const systemPrompt =
      "You are an expert ESL lesson writer. You create clean, accurate, positive English lessons for adult and teen learners. You ALWAYS reply with ONLY valid JSON, no markdown, no preamble.";

    const userPrompt = `
Create an ESL reading lesson. Level: ${levelGuide}
${source}

Reply with ONLY this JSON shape (no extra text):
{
  "title": "a short engaging title",
  "kicker": "a 2-3 word category like 'Science · Reading'",
  "paras": ["paragraph 1", "paragraph 2", "..."],
  "vocab": [{"w":"word","p":"(n)","d":"simple definition"}],
  "comprehension": [{"q":"question 1 text","options":["choice A","choice B","choice C","choice D"],"correct":0}, "..."],
  "compAnswers": ["one short sentence explaining why that answer is correct", "..."],
  "discussion": ["question 1 text", "..."]
}
In the paragraphs, wrap each vocabulary word in <b></b> the first time it appears. Each comprehension question is multiple choice: exactly 4 options, "correct" is the 0-based index of the right one, and the wrong options should be plausible but clearly wrong to someone who read the article — not silly or random. compAnswers must match comprehension order and length. Discussion questions are open-ended, for the student to answer freely in their own words out loud or in writing — plain question text only, no options or "correct" answer.`;

    let lesson;

    if (engine === "claude") {
      // ---- Claude (Anthropic) ----
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Vercel" });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });
      const data = await r.json();
      const lessonText = data?.content?.[0]?.text || "";
      // The AI sometimes wraps JSON in ```json fences — strip them.
      const clean = lessonText.replace(/```json/gi, "").replace(/```/g, "").trim();
      try {
        lesson = JSON.parse(clean);
      } catch (e) {
        return res.status(502).json({ error: "AI did not return valid JSON", raw: clean.slice(0, 400) });
      }
    } else {
      // ---- DeepSeek (default) ----
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) return res.status(500).json({ error: "DEEPSEEK_API_KEY not set in Vercel" });
      const result = await dsChatJSON(key, { system: systemPrompt, user: userPrompt, temperature: 0.7 });
      if (!result.ok) return res.status(502).json({ error: "AI did not return valid JSON", raw: result.raw || "" });
      lesson = result.data;
    }
    lesson.comprehension = sanitizeChoiceQuestions(lesson.comprehension);
    lesson.discussion = sanitizeChoiceQuestions(lesson.discussion);

    // add the meta/levelTag the front-end expects
    const meta = {
      easy:   "Beginner · CEFR A2 · ~40 min",
      medium: "Intermediate · CEFR B1 · ~50 min",
      hard:   "Advanced · CEFR B2 · ~60 min"
    }[level] || "Intermediate · CEFR B1";
    const levelTag = {
      easy: "Beginner · A2", medium: "Intermediate · B1", hard: "Advanced · B2"
    }[level] || "Intermediate · B1";

    lesson.meta = meta;
    lesson.levelTag = levelTag;
    lesson.note = "";

    // Save into the same lessons table the library/Path/lesson viewer read
    // from, so a user-created lesson gets the full interactive experience
    // (Present mode, per-word audio, draggable word search, Korean toggle)
    // instead of only ever existing as a one-off static print sheet.
    const siteLevel = { easy: "beginner", medium: "intermediate", hard: "advanced" }[level] || "intermediate";
    const secret = process.env.SUPABASE_SECRET_KEY;
    // Every custom lesson used to be silently PUBLIC — visible/listed to
    // any visitor, logged in or not — regardless of what the creator
    // intended. Now it's an explicit choice from the client (see
    // public/create.html's "Keep this private" checkbox), defaulting to
    // public only when the field is missing entirely (e.g. a direct API
    // call from before this existed) so old integrations keep working.
    const vis = visibility === "private" ? "private" : "public";
    const partTitle = (isPart && partOf && partOf > 1) ? `${lesson.title} — Part ${partN}/${partOf}` : lesson.title;
    let savedId = null;
    if (secret) {
      try {
        const id = slug(partTitle) + "-" + Math.random().toString(36).slice(2, 7);
        // fetch a real photo now, so this lesson never has to wait for
        // someone to view it or for a backfill run before it looks right
        // in the Library/Path card grids
        const photo = await fetchUnsplashPhoto(lesson.title, process.env.UNSPLASH_ACCESS_KEY);
        const data = {
          id, level: siteLevel, type: "reading",
          icon: "📄", title: partTitle, kicker: lesson.kicker,
          summary: (lesson.paras && lesson.paras[0] ? lesson.paras[0].replace(/<[^>]+>/g, "").slice(0, 110) : ""),
          paras: lesson.paras || [], vocab: lesson.vocab || [],
          comprehension: lesson.comprehension || [], compAnswers: lesson.compAnswers || [], discussion: lesson.discussion || [],
          custom: true, // made via Create Your Own — always free for the creator to view right away
          visibility: vis,
          ...(isPart ? { seq: partN, series: { title: String(seriesTitle || lesson.title).slice(0, 150), index: partN, total: partOf } } : {}),
          ...(photo ? { image: photo.url, imageAlt: photo.alt, imageCredit: photo.credit } : {})
        };
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/lessons`, {
          method: "POST",
          headers: {
            apikey: secret, Authorization: "Bearer " + secret,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify([{ id, level: siteLevel, topic, type: "reading", title: partTitle, data, created_by: user.id, visibility: vis }])
        });
        if (ins.ok) savedId = id;
      } catch (e) { /* saving is best-effort — the lesson still renders even if this fails */ }
    }

    lesson.id = savedId;
    lesson.title = partTitle;
    lesson.visibility = vis;
    if (truncated && !isPart) lesson.truncated = true;
    return res.status(200).json(lesson);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
}
