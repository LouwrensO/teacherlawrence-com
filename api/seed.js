// /api/seed.js  — one-time loader: copies the lessons from the static
// public/lessons.js into the Supabase database. Protected by SEED_TOKEN.
// Visit /api/seed?token=YOUR_TOKEN once after setting the env vars.
const SUPABASE_URL = "https://ffkukwgbslmuhrmbyfts.supabase.co";
const SITE = "https://teacherlawrence.com";

export default async function handler(req, res) {
  try {
    const token = req.query.token || "";
    if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN) {
      return res.status(403).json({ error: "bad or missing token" });
    }
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "SUPABASE_SECRET_KEY not set in Vercel" });

    // pull the canonical lesson data from the deployed static file and evaluate it
    const txt = await (await fetch(SITE + "/lessons.js")).text();
    const getData = new Function(txt + "\n;return { LESSONS, COMP_ANSWERS, topicOf };");
    const { LESSONS, COMP_ANSWERS, topicOf } = getData();

    const rows = LESSONS.map(L => ({
      id: L.id,
      level: L.level,
      topic: topicOf(L),
      type: L.type || "reading",
      title: L.title,
      data: Object.assign({}, L, {
        compAnswers: L.compAnswers || (COMP_ANSWERS && COMP_ANSWERS[L.id]) || null
      })
    }));

    const r = await fetch(`${SUPABASE_URL}/rest/v1/lessons`, {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "insert failed", detail: detail.slice(0, 600) });
    }
    return res.status(200).json({ ok: true, seeded: rows.length });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
