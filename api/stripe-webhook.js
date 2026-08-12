// /api/stripe-webhook.js — Stripe tells us when someone subscribes or cancels.
// Verifies the signature, then flips the user's `subscribed` flag in Supabase.
import crypto from "crypto";

export const config = { api: { bodyParser: false } }; // we need the raw body

const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// verify Stripe's "t=...,v1=..." signature header
function verify(raw, header, secret) {
  const parts = Object.fromEntries((header || "").split(",").map(kv => kv.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw.toString()}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch { return false; }
}

async function upsertProfile(row) {
  const key = process.env.SUPABASE_SECRET_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: key, Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([row])
  });
}

export default async function handler(req, res) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET not set" });
    const raw = await rawBody(req);
    if (!verify(raw, req.headers["stripe-signature"], secret))
      return res.status(400).json({ error: "bad signature" });

    const event = JSON.parse(raw.toString());
    const o = event.data && event.data.object;

    if (event.type === "checkout.session.completed") {
      const uid = o.client_reference_id || (o.metadata && o.metadata.supabase_user_id);
      if (uid) await upsertProfile({ id: uid, subscribed: true, stripe_customer_id: o.customer || null, updated_at: new Date().toISOString() });
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const uid = o.metadata && o.metadata.supabase_user_id;
      const active = ["active", "trialing", "past_due"].includes(o.status) && event.type !== "customer.subscription.deleted";
      if (uid) await upsertProfile({
        id: uid,
        subscribed: active,
        current_period_end: o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
