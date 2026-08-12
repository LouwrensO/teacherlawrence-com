// /api/image.js
// Runs ON THE SERVER (Vercel). Finds one relevant photo for a lesson
// using the free Unsplash API. Your Unsplash key lives in a Vercel
// Environment Variable called UNSPLASH_ACCESS_KEY and is never sent to
// the browser.
//
// GET  ?query=...   -> { url, alt, credit:{ name, link } } (search Unsplash)
// POST { id, url, alt, credit } -> persists a lesson's fetched photo into
//   Supabase so it's found once and then reused everywhere (the lesson
//   page AND the library/Path card grids). Merged into this file (was
//   /api/save-image.js) to stay under Vercel's Hobby-plan 12-function cap.
const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";

async function searchUnsplash(req, res) {
  try {
    const query = (req.query && req.query.query) || "";
    const key = process.env.UNSPLASH_ACCESS_KEY;

    // No key yet? Fail softly so lessons still load (they fall back to the emoji).
    if (!key) return res.status(200).json({ url: null, reason: "no-key" });
    if (!query.trim()) return res.status(200).json({ url: null, reason: "no-query" });

    const api = "https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&content_filter=high&query="
      + encodeURIComponent(query);

    const r = await fetch(api, { headers: { Authorization: "Client-ID " + key } });
    if (!r.ok) return res.status(200).json({ url: null, reason: "unsplash-" + r.status });

    const data = await r.json();
    const photo = data && data.results && data.results[0];
    if (!photo) return res.status(200).json({ url: null, reason: "no-results" });

    // Cache for a day at the edge — these are static lessons.
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({
      url: photo.urls && (photo.urls.regular || photo.urls.small),
      alt: photo.alt_description || query,
      credit: {
        name: photo.user && photo.user.name,
        link: photo.user && photo.user.links && photo.user.links.html
      }
    });
  } catch (err) {
    return res.status(200).json({ url: null, reason: String(err && err.message || err) });
  }
}

// best-effort: called fire-and-forget from the browser after a successful
// GET search above. Failing here never breaks the lesson.
async function saveImage(req, res) {
  try {
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return res.status(200).json({ ok: false, reason: "no-secret" });

    const { id, url, alt, credit } = req.body || {};
    if (!id || !url) return res.status(200).json({ ok: false, reason: "missing id/url" });

    const headers = { apikey: secret, Authorization: "Bearer " + secret };

    // read-modify-write: merge into the existing data blob so we don't
    // clobber the rest of the lesson.
    const gr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(id)}&select=data`, { headers });
    const rows = await gr.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: false, reason: "not found" });
    if (rows[0].data && rows[0].data.image) return res.status(200).json({ ok: true, reason: "already set" });

    const data = { ...rows[0].data, image: url, imageAlt: alt || "", imageCredit: credit || null };
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ data })
    });
    if (!pr.ok) return res.status(200).json({ ok: false, reason: "update failed" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: String((e && e.message) || e) });
  }
}

export default async function handler(req, res) {
  if (req.method === "POST") return saveImage(req, res);
  return searchUnsplash(req, res);
}
