// /api/translate.js — Korean (or other language) lesson translation, in two
// modes dispatched by HTTP method. Merged from what used to be two separate
// serverless functions (translate.js + translate-one.js) — the Vercel Hobby
// plan caps a deployment at 12 functions, and adding /api/speak-chat pushed
// the project to 13, so this pair (near-identical DeepSeek prompt/logic
// already) was consolidated to make room rather than dropping a feature.
//
//   GET  /api/translate?token=YOUR_TOKEN            -> admin bulk tool (public/translate.html):
//                                                        translate the next lesson that needs it
//   GET  /api/translate?token=YOUR_TOKEN&id=colours -> a specific lesson
//   GET  /api/translate?token=YOUR_TOKEN&lang=ko    -> choose language (default ko)
//   POST /api/translate {id, lang}                  -> app-triggered (lesson.html/games.html),
//                                                        no token: translates ONE lesson in the
//                                                        background right after it loads with no
//                                                        Korean yet. Idempotent — a lesson already
//                                                        translated into that language is a cheap
//                                                        no-op, so calling more than once is harmless.
import { dsChatJSON } from "./_ds.js";

const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const PUBLISHABLE = "YOUR-NEW-PUBLISHABLE-KEY";
const LANG_NAME = { ko: "Korean", zh: "Simplified Chinese", ja: "Japanese", es: "Spanish" };

function stripTags(s) { return (s || "").replace(/<[^>]+>/g, ""); }
function sentences(t) { return (t.match(/[^.!?]+[.!?]*/g) || [t]).map(s => s.trim()).filter(Boolean); }

// comprehension AND discussion entries are either a plain string (older
// lessons) or {q, options, correct} (newer, multiple-choice — see
// api/make.js / api/generate.js). Only q/options are translatable text;
// strip the object down to just that for the AI payload, then merge the
// translated text back into the ORIGINAL shape afterward so `correct` (an
// index, not text) and array length can never drift from what the lesson
// actually has. Shared by both fields since the shape is identical.
function choiceForTranslate(list) {
  return (list || []).map(q =>
    (q && typeof q === "object" && Array.isArray(q.options)) ? { q: q.q, options: q.options } : q
  );
}
function choiceFromTranslated(original, translated) {
  return (original || []).map((q, i) => {
    const t = translated && translated[i];
    if (q && typeof q === "object" && Array.isArray(q.options)) {
      const opts = (t && Array.isArray(t.options) && t.options.length === q.options.length) ? t.options : q.options;
      return { q: (t && typeof t.q === "string" && t.q) || q.q, options: opts, correct: q.correct };
    }
    return (typeof t === "string" && t) ? t : (q || "");
  });
}

async function translateOne(req, res) {
  const { id, lang: langRaw } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  const lang = (langRaw || "ko").toLowerCase();
  const langName = LANG_NAME[lang] || "Korean";

  const secret = process.env.SUPABASE_SECRET_KEY;
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (!secret || !dsKey) return res.status(200).json({ ok: false, reason: "not configured" });
  const headers = { apikey: secret, Authorization: "Bearer " + secret };

  const lr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(id)}&select=data`, { headers });
  const lrows = await lr.json();
  const row = Array.isArray(lrows) && lrows[0];
  if (!row || !row.data) {
    return res.status(200).json({ ok: false, reason: "lesson not found" });
  }
  if (row.data.type === "flashcards") {
    return res.status(200).json({ ok: false, reason: "flashcard lessons use a different data shape, not supported yet" });
  }

  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/translations?lesson_id=eq.${encodeURIComponent(id)}&lang=eq.${lang}&select=data`,
    { headers }
  );
  const existingRows = await existing.json();
  if (Array.isArray(existingRows) && existingRows[0] && existingRows[0].data && existingRows[0].data.comprehension) {
    return res.status(200).json({ ok: true, alreadyDone: true, data: existingRows[0].data });
  }

  const d = row.data;
  const paras = (d.paras || []).map(p => sentences(stripTags(p)));
  const flat = [];
  paras.forEach(p => p.forEach(s => flat.push(s)));
  const vocab = (d.vocab || []).map(v => ({ w: v.w || "", d: v.d || "" }));
  const comprehension = choiceForTranslate(d.comprehension);
  const discussion = choiceForTranslate(d.discussion);

  const payload = { title: d.title || "", summary: d.summary || "", sentences: flat, vocab, comprehension, discussion };
  const prompt =
    `Translate the English strings in this JSON into natural, accurate ${langName}. ` +
    `For the "vocab" array, translate BOTH the "w" (word) and "d" (definition) field of each item, ` +
    `keeping the same {w,d} object shape and array length. ` +
    `The "comprehension" and "discussion" arrays EACH have EITHER plain strings OR {q,options} objects (multiple-choice) — ` +
    `for a {q,options} item, translate "q" and every string inside "options", keeping that same shape. ` +
    `The "sentences" array MUST be translated one-for-one: return EXACTLY ${flat.length} items, ` +
    `where item i is the direct translation of input sentence i, in the same order. ` +
    `Never merge two sentences into one, split one sentence into two, or reorder them — ` +
    `each output sentence is read back paired with its English original by position, so a length or order ` +
    `mismatch pairs the wrong sentences together. ` +
    `For all other keys, return the same keys and array lengths, ` +
    `each English string replaced by its ${langName} translation. Do not add or remove items.\n\n` +
    JSON.stringify(payload);

  const result = await dsChatJSON(dsKey, {
    system: "You are a professional translator. Reply with ONLY valid JSON.",
    user: prompt,
    temperature: 0.3
  });
  if (!result.ok) {
    console.warn("[translate] POST /api/translate JSON parse failed for lesson " + id + ": " + result.error + " raw: " + result.raw);
    return res.status(200).json({ ok: false, reason: "translator did not return JSON" });
  }
  const t = result.data;
  // Guard against sentence-count drift (see the "sentences" prompt instruction
  // above): if the translator merged/split/dropped a sentence, EVERY sentence
  // after that point would silently pair with the wrong Korean text once
  // zipped back positionally below. Refuse to save a translation like that —
  // same "fail soft with a reason" pattern as the JSON-parse failure above —
  // rather than storing English/Korean pairs that don't actually match.
  if (!Array.isArray(t.sentences) || t.sentences.length !== flat.length) {
    console.warn("[translate] POST /api/translate sentence count mismatch for lesson " + id + ": expected " + flat.length + " got " + (Array.isArray(t.sentences) ? t.sentences.length : "non-array"));
    return res.status(200).json({ ok: false, reason: "sentence count mismatch" });
  }

  const koFlat = Array.isArray(t.sentences) ? t.sentences : [];
  let k = 0;
  const outParas = paras.map(p => p.map(en => ({ en, ko: koFlat[k++] || "" })));
  const data = {
    title: t.title || "", summary: t.summary || "", paras: outParas,
    vocab: Array.isArray(t.vocab) ? t.vocab.map(v => ({ w: (v && v.w) || "", d: (v && v.d) || "" })) : [],
    comprehension: choiceFromTranslated(d.comprehension, t.comprehension),
    discussion: choiceFromTranslated(d.discussion, t.discussion)
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/translations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ lesson_id: id, lang, data }])
  });
  if (!ins.ok) return res.status(200).json({ ok: false, reason: "store failed" });

  return res.status(200).json({ ok: true, data });
}

async function translateBulk(req, res) {
  const token = req.query.token || "";
  if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN)
    return res.status(403).json({ error: "bad or missing token" });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (!dsKey) return res.status(500).json({ error: "DEEPSEEK_API_KEY not set" });

  const lang = (req.query.lang || "ko").toLowerCase();
  const langName = LANG_NAME[lang] || "Korean";
  const readHeaders = { apikey: PUBLISHABLE, Authorization: "Bearer " + PUBLISHABLE };

  const [lr, tr] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lessons?select=id,type,data`, { headers: readHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/translations?lang=eq.${lang}&select=lesson_id,data`, { headers: readHeaders })
  ]);
  const lessons = await lr.json();
  // "done" only if it already has the FULL shape (comprehension present)
  // AND current-format vocab ({w,d} pairs, not the older flat definition
  // strings) — so lessons translated before word-level Korean existed
  // come back around and get refreshed with this same tool.
  const hasCurrentVocab = (data) => {
    const v = data && data.vocab;
    if (!Array.isArray(v) || v.length === 0) return true;
    return typeof v[0] === "object" && v[0] !== null;
  };
  const done = new Set((await tr.json() || [])
    .filter(t => t.data && t.data.comprehension && hasCurrentVocab(t.data))
    .map(t => t.lesson_id));

  const translatable = lessons.filter(l => (l.data.type || l.type || "reading") === "reading");
  let target = req.query.id ? translatable.find(l => l.id === req.query.id)
                            : translatable.find(l => !done.has(l.id));
  const remaining = translatable.filter(l => !done.has(l.id)).length;
  if (!target) return res.status(200).json({ ok: true, message: "nothing to translate", remaining: 0 });

  const d = target.data;
  const paras = (d.paras || []).map(p => sentences(stripTags(p)));
  const flat = [];
  paras.forEach(p => p.forEach(s => flat.push(s)));
  const vocab = (d.vocab || []).map(v => ({ w: v.w || "", d: v.d || "" }));
  const comprehension = choiceForTranslate(d.comprehension);
  const discussion = choiceForTranslate(d.discussion);

  const payload = { title: d.title || "", summary: d.summary || "", sentences: flat, vocab, comprehension, discussion };
  const prompt =
    `Translate the English strings in this JSON into natural, accurate ${langName}. ` +
    `For the "vocab" array, translate BOTH the "w" (word) and "d" (definition) field of each item, ` +
    `keeping the same {w,d} object shape and array length. ` +
    `The "comprehension" and "discussion" arrays EACH have EITHER plain strings OR {q,options} objects (multiple-choice) — ` +
    `for a {q,options} item, translate "q" and every string inside "options", keeping that same shape. ` +
    `The "sentences" array MUST be translated one-for-one: return EXACTLY ${flat.length} items, ` +
    `where item i is the direct translation of input sentence i, in the same order. ` +
    `Never merge two sentences into one, split one sentence into two, or reorder them — ` +
    `each output sentence is read back paired with its English original by position, so a length or order ` +
    `mismatch pairs the wrong sentences together. ` +
    `For all other keys, return the same keys and array lengths, ` +
    `each English string replaced by its ${langName} translation. Do not add or remove items.\n\n` +
    JSON.stringify(payload);

  const result = await dsChatJSON(dsKey, {
    system: "You are a professional translator. Reply with ONLY valid JSON.",
    user: prompt,
    temperature: 0.3
  });
  if (!result.ok) return res.status(502).json({ error: "translator did not return JSON", raw: result.raw || "" });
  const t = result.data;
  // Same sentence-count drift guard as the POST handler above — refuse to
  // save a translation whose sentence count doesn't match the English
  // original, since that silently pairs the wrong sentences together once
  // zipped back positionally.
  if (!Array.isArray(t.sentences) || t.sentences.length !== flat.length) {
    console.warn("[translate] GET /api/translate sentence count mismatch for lesson " + target.id + ": expected " + flat.length + " got " + (Array.isArray(t.sentences) ? t.sentences.length : "non-array"));
    return res.status(200).json({ ok: false, reason: "sentence count mismatch", lesson: target.id });
  }

  // regroup translated sentences back into paragraphs, paired with English
  const koFlat = Array.isArray(t.sentences) ? t.sentences : [];
  let k = 0;
  const outParas = paras.map(p => p.map(en => ({ en, ko: koFlat[k++] || "" })));

  const data = {
    title: t.title || "",
    summary: t.summary || "",
    paras: outParas,
    vocab: Array.isArray(t.vocab) ? t.vocab.map(v => ({ w: (v && v.w) || "", d: (v && v.d) || "" })) : [],
    comprehension: choiceFromTranslated(d.comprehension, t.comprehension),
    discussion: choiceFromTranslated(d.discussion, t.discussion)
  };

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/translations`, {
    method: "POST",
    headers: {
      apikey: secret, Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([{ lesson_id: target.id, lang, data }])
  });
  if (!ins.ok) { const dd = await ins.text(); return res.status(502).json({ error: "store failed", detail: dd.slice(0, 400) }); }

  return res.status(200).json({ ok: true, translated: target.id, lang, remaining: remaining - 1 });
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") return await translateOne(req, res);
    return await translateBulk(req, res);
  } catch (e) {
    return res.status(req.method === "POST" ? 200 : 500).json(
      req.method === "POST" ? { ok: false, reason: String((e && e.message) || e) } : { error: String((e && e.message) || e) }
    );
  }
}
