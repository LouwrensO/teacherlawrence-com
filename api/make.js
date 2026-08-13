// /api/make.js — mass-production creator. Generates ONE full lesson per call
// (via DeepSeek) from the curriculum plan and stores it in Supabase with a
// sequence number (which powers the learning Path). Token-protected.
//
//   /api/make?token=YOUR_TOKEN   -> makes the next lesson the plan is missing
// Returns { made, level, remaining } so a progress page can loop it.
import { PLAN, LEVEL_ORDER } from "./_plan.js";
import { fetchUnsplashPhoto } from "./_unsplash.js";
import { dsChatJSON } from "./_ds.js";

const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";
const PUBLISHABLE = "sb_publishable_YBAbltikDkK6ag5PAjTJXg_99i6Yow8";

const GUIDE = {
  beginner:     "CEFR A1. Very simple, short sentences. ~150 words, 3 short paragraphs. 6 vocab. 3 comprehension, 3 discussion.",
  elementary:   "CEFR A2. Simple, clear. ~260 words, 3-4 paragraphs. 6 vocab. 4 comprehension, 3 discussion.",
  "pre-int":    "CEFR A2-B1. ~360 words, 4 paragraphs. 8 vocab. 5 comprehension, 4 discussion.",
  intermediate: "CEFR B1. ~450 words, 4 paragraphs. 8 vocab. 5 comprehension, 5 discussion.",
  upper:        "CEFR B2. Rich but clear. ~520 words, 4-5 paragraphs. 8 vocab. 5 comprehension, 5 discussion.",
  advanced:     "CEFR C1. Sophisticated. ~560 words, 5 paragraphs. 8 vocab. 5 comprehension, 5 discussion.",
  super:        "CEFR C2. Highly sophisticated, elegant. ~600 words, 5 paragraphs. 8 vocab. 5 comprehension, 5 discussion."
};

function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

// The AI is asked for multiple-choice comprehension questions
// ({q,options,correct}), but its JSON isn't guaranteed well-formed —
// missing options, a correct index out of range, etc. Any entry that
// doesn't clearly qualify falls back to a plain question string instead,
// which public/lesson.html already renders as the older typed+AI-scored
// flow (see compQuestionHtml()/talkQuestionHtml()) — degrades gracefully
// rather than shipping a broken multiple-choice question. Also applied
// to discussion (Let's Talk) for the same graceful-degradation reason,
// even though discussion is no longer PROMPTED as multiple-choice — a
// lesson generated before that changed, or one run through the
// now-retired upgrade-discussion.html tool, can still have
// {q,options,correct} entries there, and this keeps rendering them
// correctly either way.
function sanitizeChoiceQuestions(list) {
  // never drops an entry (keeps comprehension/compAnswers or discussion
  // index-aligned) — anything unrecognizable becomes an empty string, same
  // as a lesson that shipped with fewer questions than compAnswers; the
  // client already tolerates that (compQuestionHtml() just renders an
  // empty question).
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

export default async function handler(req, res) {
  try {
    const token = req.query.token || "";
    if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN)
      return res.status(403).json({ error: "bad or missing token" });
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });
    const dsKey = process.env.DEEPSEEK_API_KEY;
    if (!dsKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not set" });

    // ?upgradeComprehension=1 — separate loop from the curriculum-plan one
    // below: rewrites an EXISTING lesson's comprehension into the newer
    // multiple-choice shape (see public/upgrade-comprehension.html), rather
    // than making a brand new lesson. Lives here (not its own file) to
    // stay under the Vercel Hobby plan's 12-serverless-function cap — see
    // the same reasoning in api/translate.js's file-header comment.
    if (req.query.upgradeComprehension) return upgradeComprehensionOne(req, res, secret, dsKey);
    // retired — see upgradeDiscussionOne()'s own comment further down.
    if (req.query.upgradeDiscussion) return upgradeDiscussionOne(req, res);
    // ?fixDiscussionChoices=1 — one-shot bulk cleanup for the reverse
    // problem: existing PUBLISHED lessons whose discussion/practise
    // questions are already {q,options,correct} (from the old buggy
    // generation prompt, or from the now-retired upgradeDiscussionOne())
    // get simplified back down to plain open-ended question strings. See
    // fixDiscussionChoicesAll()'s own comment further down for why this
    // needs no AI call and can safely run as one request across every
    // lesson, unlike the per-lesson AI-rewrite tools above.
    if (req.query.fixDiscussionChoices) return fixDiscussionChoicesAll(req, res, secret);
    // ?migrateLessons=1 — one-time tool (see public/migrate-lessons.html):
    // copies public.lessons (visibility='public' only) + their
    // public.translations from the OLD shared esllearner.com database into
    // this project's own database. Lives here rather than its own file for
    // the same Vercel Hobby 12-function-cap reason as the branches above.
    if (req.query.migrateLessons) return migrateLessons(req, res, secret);

    // flatten the plan into an ordered list
    const planned = [];
    LEVEL_ORDER.forEach(level => (PLAN[level] || []).forEach((t, i) =>
      planned.push({ id: slug(t.title), title: t.title, topic: t.topic, level, seq: i })));

    // which already exist?
    const lr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?select=id`,
      { headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + PUBLISHABLE } });
    const existing = new Set((await lr.json() || []).map(x => x.id));

    const target = req.query.id ? planned.find(p => p.id === req.query.id)
                                : planned.find(p => !existing.has(p.id));
    const remaining = planned.filter(p => !existing.has(p.id)).length;
    if (!target) return res.status(200).json({ ok: true, message: "plan complete", remaining: 0 });

    const guide = GUIDE[target.level] || GUIDE.intermediate;
    const isBible = target.topic === "Bible";
    const brief = isBible
      ? "Retell this well-known Bible story or topic simply and respectfully for ESL learners. Keep it age-appropriate, warm, and non-denominational (suitable for readers of any faith background or none); avoid graphic or frightening detail even where the original story has some."
      : "Write an original, uplifting, classroom-safe article. Positive, factual, engaging. No violence, politics, tragedy, or anything unsuitable for a classroom.";
    const userPrompt = `
Create an ESL reading lesson titled "${target.title}". Level: ${guide}
${brief}

Reply with ONLY this JSON (no extra text):
{
  "title": "${target.title}",
  "summary": "one short sentence for a library card",
  "icon": "a single emoji that fits the topic",
  "paras": ["paragraph 1", "paragraph 2", "..."],
  "vocab": [{"w":"word","p":"(n)","d":"simple definition"}],
  "comprehension": [{"q":"question 1 text","options":["choice A","choice B","choice C","choice D"],"correct":0}, "..."],
  "compAnswers": ["one short sentence explaining why that answer is correct", "..."],
  "discussion": ["question 1 text", "..."]
}
In the paragraphs, wrap each vocab word in <b></b> the first time it appears. Never include a part-of-speech tag like (n)/(v)/(adj) inside the paragraph prose itself — those belong only in the vocab list's own "p" field. Each comprehension question is multiple choice: exactly 4 options, "correct" is the 0-based index of the right one, and the wrong options should be plausible but clearly wrong to someone who read the article — not silly or random. compAnswers must match comprehension order and length. Discussion questions are open-ended, for the student to answer freely in their own words out loud or in writing — plain question text only, no options or "correct" answer.`;

    const result = await dsChatJSON(dsKey, {
      system: "You are an expert ESL lesson writer. Reply with ONLY valid JSON.",
      user: userPrompt,
      temperature: 0.7
    });
    if (!result.ok) return res.status(502).json({ error: "AI did not return JSON", raw: result.raw || "" });
    const L = result.data;

    // fetch a real photo now, so this lesson never has to wait for
    // someone to view it or for a backfill run before it looks right in
    // the Library/Path card grids
    const photo = await fetchUnsplashPhoto(L.title || target.title, process.env.UNSPLASH_ACCESS_KEY);

    const data = {
      id: target.id,
      level: target.level,
      type: "reading",
      category: target.topic,
      topic: target.topic,
      icon: L.icon || "📄",
      title: L.title || target.title,
      kicker: target.topic + " · Reading",
      summary: L.summary || "",
      seq: target.seq,
      paras: L.paras || [],
      vocab: L.vocab || [],
      comprehension: sanitizeChoiceQuestions(L.comprehension),
      compAnswers: L.compAnswers || [],
      discussion: sanitizeChoiceQuestions(L.discussion),
      ...(photo ? { image: photo.url, imageAlt: photo.alt, imageCredit: photo.credit } : {})
    };

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/lessons`, {
      method: "POST",
      headers: {
        apikey: secret, Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([{
        id: target.id, level: target.level, topic: target.topic,
        type: "reading", title: data.title, data
      }])
    });
    if (!ins.ok) { const d = await ins.text(); return res.status(502).json({ error: "store failed", detail: d.slice(0, 400) }); }

    return res.status(200).json({ ok: true, made: target.id, level: target.level, remaining: remaining - 1 });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}

// a comprehension array "needs upgrading" if any entry is still a plain
// string (the older, typed+AI-scored shape) rather than the newer
// {q,options,correct} multiple-choice one — see sanitizeChoiceQuestions()
// above and public/lesson.html's compQuestionHtml() for how both shapes
// render. An empty array (a lesson with no comprehension questions at
// all) has nothing to upgrade.
function needsComprehensionUpgrade(data) {
  const c = data && data.comprehension;
  return Array.isArray(c) && c.length > 0 && c.some(q => typeof q === "string" && q.trim());
}

// rewrites ONE existing lesson's comprehension into multiple-choice,
// looping the same way /api/make's curriculum-plan mode does — see
// public/upgrade-comprehension.html, which calls this repeatedly until
// `remaining` hits 0. Everything else about the lesson (title, paras,
// vocab, discussion, image...) is left exactly as it was; only
// `comprehension`/`compAnswers` are replaced.
async function upgradeComprehensionOne(req, res, secret, dsKey) {
  const lr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?select=id,type,data`,
    { headers: { apikey: secret, Authorization: "Bearer " + secret } });
  if (!lr.ok) return res.status(502).json({ error: "lesson list failed", detail: (await lr.text()).slice(0, 300) });
  const lessons = await lr.json();

  const candidates = lessons.filter(l => (l.data.type || l.type || "reading") === "reading" && needsComprehensionUpgrade(l.data));
  const target = req.query.id ? lessons.find(l => l.id === req.query.id) : candidates[0];
  const remaining = candidates.length;
  if (!target) return res.status(200).json({ ok: true, message: "all lessons already upgraded", remaining: 0 });

  const d = target.data || {};
  const articleText = (d.paras || []).map(p => String(p).replace(/<[^>]+>/g, "")).join(" ").slice(0, 4000);
  const oldQuestions = (d.comprehension || []).map(q => (q && typeof q === "object") ? q.q : q);

  const userPrompt = `
Here is an ESL reading article:
"""${articleText}"""

Turn each of these existing comprehension questions into a multiple-choice
version testing the same understanding (keep the same question if it
already works as multiple choice, or write an equivalent one):
${oldQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Reply with ONLY this JSON (no extra text):
{
  "comprehension": [{"q":"question text","options":["choice A","choice B","choice C","choice D"],"correct":0}],
  "compAnswers": ["one short sentence explaining why that answer is correct"]
}
Keep the same number of questions, in the same order, as the list above.
Exactly 4 options per question. "correct" is the 0-based index of the
right one. Wrong options should be plausible but clearly wrong to someone
who read the article — not silly or random.`;

  const result = await dsChatJSON(dsKey, {
    system: "You are an expert ESL lesson writer. Reply with ONLY valid JSON.",
    user: userPrompt,
    temperature: 0.5
  });
  if (!result.ok) return res.status(502).json({ error: "AI did not return JSON", raw: result.raw || "", lessonId: target.id });

  const newData = Object.assign({}, d, {
    comprehension: sanitizeChoiceQuestions(result.data.comprehension),
    compAnswers: Array.isArray(result.data.compAnswers) ? result.data.compAnswers : (d.compAnswers || [])
  });

  const upd = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(target.id)}`, {
    method: "PATCH",
    headers: { apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ data: newData })
  });
  if (!upd.ok) { const t = await upd.text(); return res.status(502).json({ error: "save failed", detail: t.slice(0, 400) }); }

  // the lesson's comprehension text/shape just changed, so any existing
  // Korean translation is now stale (still has the old plain-string
  // questions) — delete it rather than leave a mismatch; the per-lesson
  // background job in api/translate.js (fired from lesson.html on load)
  // regenerates it automatically against the new shape.
  await fetch(`${SUPABASE_URL}/rest/v1/translations?lesson_id=eq.${encodeURIComponent(target.id)}`, {
    method: "DELETE",
    headers: { apikey: secret, Authorization: "Bearer " + secret }
  }).catch(() => {});

  return res.status(200).json({ ok: true, upgraded: target.id, remaining: remaining - 1 });
}

// RETIRED — Let's Talk / Let's Practise are meant to stay open-ended
// (free discussion, AI-graded), not multiple-choice; see the discussion
// prompt change in this file's main userPrompt and in api/generate.js.
// This tool did the opposite (converted existing plain-string discussion
// questions INTO multiple-choice, via an AI rewrite) and would silently
// undo that intent if ever run again, so it's disabled entirely — see
// git history for the original implementation if it's ever needed again.
// (Comprehension's equivalent, upgradeComprehensionOne(), is UNCHANGED —
// comprehension is still meant to be multiple-choice.)
async function upgradeDiscussionOne(req, res) {
  return res.status(410).json({
    ok: false,
    error: "retired: Let's Talk/Let's Practise are meant to stay open-ended now, not multiple-choice — this tool converted them the other way, so it's been disabled. See CLAUDE.md."
  });
}

// Simplifies every existing lesson's discussion (reading) / practise
// (flashcards) questions that are still {q,options,correct} back down to
// plain question strings — the reverse of what upgradeDiscussionOne()
// used to do. Needs NO AI call, unlike that tool (or
// upgradeComprehensionOne()): upgradeDiscussionOne()'s own prompt
// explicitly asked for "same question, three short natural-sounding
// answer options" — the `q` text itself was never reworded, so just
// dropping `options`/`correct` and keeping `q` restores a sensible
// open-ended question with nothing to rewrite. That also means this can
// safely run across every lesson in one request instead of needing a
// one-lesson-per-call progress loop like the AI-based tools above.
// Idempotent — a lesson with no {q,options,correct} entries left is
// skipped, so this is safe to re-run.
async function fixDiscussionChoicesAll(req, res, secret) {
  const lr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?select=id,type,data`,
    { headers: { apikey: secret, Authorization: "Bearer " + secret } });
  if (!lr.ok) return res.status(502).json({ error: "lesson list failed", detail: (await lr.text()).slice(0, 300) });
  const lessons = await lr.json();

  const toPlainQuestion = (q) => (q && typeof q === "object" && typeof q.q === "string") ? q.q : q;

  const fixed = [];
  const failed = [];
  await Promise.all(lessons.map(async (l) => {
    const d = l.data || {};
    const isFlashcards = (d.type || l.type || "reading") === "flashcards";
    const field = isFlashcards ? "practise" : "discussion";
    const list = d[field];
    if (!Array.isArray(list) || !list.some(q => q && typeof q === "object")) return;   // nothing to fix

    const newData = Object.assign({}, d, { [field]: list.map(toPlainQuestion) });
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(l.id)}`, {
      method: "PATCH",
      headers: { apikey: secret, Authorization: "Bearer " + secret, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ data: newData })
    });
    if (!upd.ok) { failed.push(l.id); return; }   // best-effort — one lesson's failure shouldn't block the rest; re-running is safe
    fixed.push(l.id);

    // same reasoning upgradeDiscussionOne() used to have: the discussion/
    // practise field's shape just changed, so any existing Korean
    // translation is stale — delete it and let the background translate
    // job regenerate it.
    fetch(`${SUPABASE_URL}/rest/v1/translations?lesson_id=eq.${encodeURIComponent(l.id)}`, {
      method: "DELETE",
      headers: { apikey: secret, Authorization: "Bearer " + secret }
    }).catch(() => {});
  }));

  return res.status(200).json({ ok: true, count: fixed.length, fixed, failed });
}

// one-time content copy from the OLD shared esllearner.com database into
// this project's own — see public/migrate-lessons.html. oldUrl/oldKey name
// the OLD project (passed in per-request, never stored); `secret` here is
// THIS project's own SUPABASE_SECRET_KEY, already verified by the caller.
// Only public.lessons (visibility='public') + their public.translations are
// touched — never users/profiles/classes/homework/submissions.
// created_by is stripped on copy since it references auth.users rows that
// only exist in the OLD project.
async function migrateLessons(req, res, secret) {
  const oldUrl = (req.query.oldUrl || "").replace(/\/$/, "");
  const oldKey = req.query.oldKey || "";
  if (!oldUrl || !oldKey) return res.status(400).json({ error: "oldUrl and oldKey required" });

  const oldHeaders = { apikey: oldKey, Authorization: "Bearer " + oldKey };
  const newHeaders = {
    apikey: secret, Authorization: "Bearer " + secret,
    "Content-Type": "application/json", Prefer: "resolution=merge-duplicates"
  };
  const PAGE = 500;

  async function fetchAll(url) {
    let all = [], offset = 0;
    while (true) {
      const r = await fetch(`${url}&offset=${offset}&limit=${PAGE}`, { headers: oldHeaders });
      if (!r.ok) throw new Error(`fetch failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const batch = await r.json();
      all = all.concat(batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  async function insertAll(url, rows) {
    let copied = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const r = await fetch(url, { method: "POST", headers: newHeaders, body: JSON.stringify(chunk) });
      if (!r.ok) throw new Error(`insert failed ${r.status}: ${(await r.text()).slice(0, 300)} (copied ${copied} so far)`);
      copied += chunk.length;
    }
    return copied;
  }

  try {
    const oldLessons = await fetchAll(`${oldUrl}/rest/v1/lessons?select=*&visibility=eq.public&order=id`);
    const cleanLessons = oldLessons.map(l => ({ ...l, created_by: null }));
    const lessonsCopied = await insertAll(`${SUPABASE_URL}/rest/v1/lessons`, cleanLessons);

    const ids = new Set(oldLessons.map(l => l.id));
    const oldTranslations = await fetchAll(`${oldUrl}/rest/v1/translations?select=*&order=lesson_id`);
    const relevantTranslations = oldTranslations.filter(t => ids.has(t.lesson_id));
    const translationsCopied = await insertAll(`${SUPABASE_URL}/rest/v1/translations`, relevantTranslations);

    return res.status(200).json({ ok: true, lessonsCopied, translationsCopied });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
