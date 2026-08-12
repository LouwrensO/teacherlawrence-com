// /api/_ds.js — shared DeepSeek call helper with a small amount of retry
// resilience. Underscore-prefixed, so Vercel doesn't count it as a route
// (this project is pinned at the Hobby plan's 12-function cap) — every
// api/*.js file that talks to DeepSeek imports from here instead of
// duplicating the fetch/retry logic.
//
// Deliberately modest: ONE retry on a transient failure (network error,
// 429, or 5xx), and — separately — ONE retry when the model's reply isn't
// valid JSON (the single most common real failure in this app: DeepSeek
// occasionally wraps or garbles the JSON it was told to return). No second
// AI provider, no queue, no exponential backoff ladder — just enough to
// stop a single blip from surfacing as a hard error to the student.

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Generic retrying fetch: retries once on a network throw, HTTP 429, or
// HTTP >=500. Never retries 4xx (other than 429) — a bad key or a blocked
// prompt won't succeed on a second try, so don't burn the extra call.
async function fetchWithRetry(url, opts, { retries = 1, timeoutMs = 12000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(t);
      if (r.ok || attempt === retries) return r;
      if (r.status === 429 || r.status >= 500) {
        await sleep(600 + Math.random() * 400);
        continue;
      }
      return r; // non-retryable HTTP error (4xx other than 429) — return as-is
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt === retries) throw e;
      await sleep(600 + Math.random() * 400);
    }
  }
  throw lastErr;
}

function stripFences(s) {
  return String(s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

/* Call DeepSeek chat/completions expecting a single JSON object back.
   opts: { system, user, temperature, max_tokens, retryTimeoutMs }
   Returns { ok:true, data } on success, or { ok:false, error, raw } — the
   raw model text is included so a caller can log/debug a persistent miss. */
async function dsChatJSON(dsKey, opts) {
  const { system, user, temperature = 0.3, max_tokens } = opts;
  async function callOnce(temp, extraSystem) {
    const r = await fetchWithRetry(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + dsKey },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: extraSystem ? system + "\n\n" + extraSystem : system },
          { role: "user", content: user }
        ],
        temperature: temp,
        ...(max_tokens ? { max_tokens } : {})
      })
    });
    const dj = await r.json().catch(() => null);
    const text = dj?.choices?.[0]?.message?.content || "";
    return stripFences(text);
  }

  let raw = "";
  try {
    raw = await callOnce(temperature);
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    // one extra attempt, specifically for a JSON-shape miss: lower
    // temperature and restate the instruction, rather than giving up
    try {
      raw = await callOnce(0.1, "Reply with ONLY the JSON object described above — no other text.");
      return { ok: true, data: JSON.parse(raw) };
    } catch (e2) {
      return { ok: false, error: "AI did not return valid JSON", raw: raw.slice(0, 400) };
    }
  }
}

/* Call DeepSeek chat/completions for a plain-text (non-JSON, non-streaming)
   reply, with the same one-retry resilience as dsChatJSON. */
async function dsChatText(dsKey, opts) {
  const { messages, temperature = 0.7, max_tokens } = opts;
  const r = await fetchWithRetry(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + dsKey },
    body: JSON.stringify({ model: "deepseek-chat", messages, temperature, ...(max_tokens ? { max_tokens } : {}) })
  });
  const dj = await r.json().catch(() => null);
  return dj?.choices?.[0]?.message?.content || "";
}

export { fetchWithRetry, dsChatJSON, dsChatText, DEEPSEEK_URL };
