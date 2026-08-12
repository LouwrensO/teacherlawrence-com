// /api/backfill-images.js — one-call-per-lesson admin tool that finds a
// lesson with no stored photo yet, fetches one from Unsplash, and saves
// it into the lesson's row (same storage /api/save-image writes to).
// Token-protected like /api/make. A small admin page loops this call
// until nothing is left, so the whole library gets real photos without
// waiting for someone to open each lesson organically.
const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";

export default async function handler(req, res) {
  try {
    const token = req.query.token || "";
    if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN)
      return res.status(403).json({ error: "bad or missing token" });
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set" });
    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!unsplashKey) return res.status(500).json({ error: "UNSPLASH_ACCESS_KEY not set" });

    const headers = { apikey: secret, Authorization: "Bearer " + secret };

    // lessons missing a photo (PostgREST supports filtering on a jsonb path directly)
    const lr = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?select=id,title:data->>title,image:data->>image&data->>image=is.null&order=id&limit=1`,
      { headers }
    );
    const rows = await lr.json();
    if (!Array.isArray(rows)) return res.status(502).json({ error: "unexpected response", rows });

    // how many remain (including this one)
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?select=id&data->>image=is.null`,
      { headers: { ...headers, Prefer: "count=exact" } }
    );
    const remaining = Number(cr.headers.get("content-range")?.split("/")?.[1]) || rows.length;

    if (!rows.length) return res.status(200).json({ ok: true, remaining: 0 });

    const target = rows[0];
    const q = encodeURIComponent(target.title || target.id);
    const ir = await fetch(
      `https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&content_filter=high&query=${q}`,
      { headers: { Authorization: "Client-ID " + unsplashKey } }
    );
    const idata = await ir.json();
    const photo = idata && idata.results && idata.results[0];

    // read-modify-write: always merge into the full existing data blob,
    // never replace it, whether or not a photo was found.
    const gr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(target.id)}&select=data`, { headers });
    const grow = (await gr.json())[0];
    const merged = photo
      ? {
          ...grow.data,
          image: photo.urls && (photo.urls.regular || photo.urls.small),
          imageAlt: photo.alt_description || target.title,
          imageCredit: { name: photo.user && photo.user.name, link: photo.user && photo.user.links && photo.user.links.html }
        }
      // no photo found for this query — mark it with a blank (non-null)
      // string so the loop doesn't get stuck retrying it forever
      : { ...grow.data, image: "" };

    const pr = await fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ data: merged })
    });
    if (!pr.ok) return res.status(502).json({ error: "update failed", detail: (await pr.text()).slice(0, 300) });

    return res.status(200).json({ done: target.id, found: !!photo, remaining: remaining - 1 });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
