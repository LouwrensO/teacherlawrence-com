// /api/checkout.js — creates a Stripe Checkout session for the $5/month plan.
// Called by subscribe.html with the signed-in user's Supabase access token.
const SUPABASE_URL = "https://YOUR-NEW-PROJECT-REF.supabase.co";
const PUBLISHABLE  = "YOUR-NEW-PUBLISHABLE-KEY";
const PRICE_ID     = "YOUR-NEW-STRIPE-PRICE-ID";
const SITE         = "https://teacherlawrence.com";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "STRIPE_SECRET_KEY not set" });

    // verify the Supabase user from their access token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "not logged in" });
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: "Bearer " + token }
    });
    if (!ur.ok) return res.status(401).json({ error: "invalid session" });
    const user = await ur.json();

    // create the subscription checkout session (Stripe REST, no SDK needed)
    const p = new URLSearchParams();
    p.append("mode", "subscription");
    p.append("line_items[0][price]", PRICE_ID);
    p.append("line_items[0][quantity]", "1");
    p.append("success_url", SITE + "/path?sub=success");
    p.append("cancel_url", SITE + "/subscribe?canceled=1");
    p.append("customer_email", user.email || "");
    p.append("client_reference_id", user.id);
    p.append("metadata[supabase_user_id]", user.id);
    p.append("subscription_data[metadata][supabase_user_id]", user.id);
    p.append("allow_promotion_codes", "true");

    const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded" },
      body: p.toString()
    });
    const session = await sr.json();
    if (!sr.ok) return res.status(502).json({ error: (session.error && session.error.message) || "stripe error" });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
