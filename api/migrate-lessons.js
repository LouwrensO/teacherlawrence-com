// /api/migrate-lessons.js — one-time tool: copies public lesson content
// (and its translations) from the old shared esllearner.com database into
// this project's own, separate database. Does NOT touch users, profiles,
// classes, homework, or submissions — only public.lessons (visibility =
// 'public') and public.translations. created_by is stripped on copy since
// it references auth.users in the OLD project, which don't exist here.
const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const { token, oldUrl, oldKey } = req.body || {};
    if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN)
      return res.status(403).json({ error: "bad token" });
    if (!oldUrl || !oldKey)
      return res.status(400).json({ error: "oldUrl and oldKey required" });

    const newKey = process.env.SUPABASE_SECRET_KEY;
    if (!newKey) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });

    const oldHeaders = { apikey: oldKey, Authorization: "Bearer " + oldKey };
    const newHeaders = {
      apikey: newKey, Authorization: "Bearer " + newKey,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates"
    };
    const PAGE = 500;

    async function fetchAll(url) {
      let all = [], offset = 0;
      while (true) {
        const r = await fetch(`${url}&offset=${offset}&limit=${PAGE}`, { headers: oldHeaders });
        if (!r.ok) throw new Error(`fetch failed ${r.status}: ${await r.text()}`);
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
        if (!r.ok) throw new Error(`insert failed ${r.status}: ${await r.text()} (copied ${copied} so far)`);
        copied += chunk.length;
      }
      return copied;
    }

    const oldLessons = await fetchAll(`${oldUrl}/rest/v1/lessons?select=*&visibility=eq.public&order=id`);
    const cleanLessons = oldLessons.map(l => ({ ...l, created_by: null }));
    const lessonsCopied = await insertAll(`${SUPABASE_URL}/rest/v1/lessons`, cleanLessons);

    const ids = new Set(oldLessons.map(l => l.id));
    const oldTranslations = await fetchAll(`${oldUrl}/rest/v1/translations?select=*&order=lesson_id`);
    const relevantTranslations = oldTranslations.filter(t => ids.has(t.lesson_id));
    const translationsCopied = await insertAll(`${SUPABASE_URL}/rest/v1/translations`, relevantTranslations);

    return res.status(200).json({ ok: true, lessonsCopied, translationsCopied });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
