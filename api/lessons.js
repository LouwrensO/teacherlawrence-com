// /api/lessons.js  — reads lessons from Supabase (public, read-only)
// The publishable key is safe to ship; Row Level Security allows SELECT only
// rows whose visibility='public' (see supabase/schema.sql). When the caller
// is logged in (sends their own Authorization: Bearer <jwt>), we forward
// THAT token instead of the bare publishable key, so PostgREST evaluates
// RLS as that specific user — the second policy ("read own private
// lessons") then also matches, letting a "Create Your Own" creator read
// their own private lesson back. Without this forwarding, every request
// looks anonymous and a private lesson would be invisible even to its
// own creator.
const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const SUPABASE_KEY = "YOUR-NEW-PUBLISHABLE-KEY";

export default async function handler(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    // apikey is always the publishable key (PostgREST requires it); the
    // bearer token is the user's own JWT when they're logged in, so RLS
    // sees their real auth.uid() — otherwise it's the same publishable
    // key as before (anon role, public-only rows).
    const headers = { apikey: SUPABASE_KEY, Authorization: "Bearer " + (userToken || SUPABASE_KEY) };
    // A per-user result (private lessons included) must never be cached at
    // a shared edge — that's a direct leak path from one visitor's request
    // serving another's private content. Only cache the plain anonymous
    // response.
    const cacheControl = userToken ? "private, no-store" : null;
    const id = req.query.id;

    if (id) {
      // one lesson + any stored translations
      const [lr, tr] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/lessons?id=eq.${encodeURIComponent(id)}&select=data`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/translations?lesson_id=eq.${encodeURIComponent(id)}&select=lang,data`, { headers })
      ]);
      const lrows = await lr.json();
      const trows = await tr.json();
      if (!Array.isArray(lrows) || !lrows.length) return res.status(404).json({ error: "not found" });
      const translations = {};
      (Array.isArray(trows) ? trows : []).forEach(t => { translations[t.lang] = t.data; });
      res.setHeader("Cache-Control", cacheControl || "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ lesson: lrows[0].data, translations });
    }

    if (req.query.meta) {
      // lightweight list for ordering/free-vs-premium checks (no article
      // text, vocab, etc.) — much smaller/faster than the full list
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/lessons?select=id,level,topic,visibility,title:data->>title,seq:data->>seq,icon:data->>icon,summary:data->>summary,image:data->>image,custom:data->>custom`,
        { headers }
      );
      const mrows = await mr.json();
      if (!Array.isArray(mrows)) return res.status(502).json({ error: "unexpected response", mrows });
      res.setHeader("Cache-Control", cacheControl || "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(mrows.map(x => ({ ...x, seq: x.seq != null ? Number(x.seq) : null })));
    }

    // full list (each row's data is a complete lesson object)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/lessons?select=data`, { headers });
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(502).json({ error: "unexpected response", rows });
    res.setHeader("Cache-Control", cacheControl || "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(rows.map(x => x.data));
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
