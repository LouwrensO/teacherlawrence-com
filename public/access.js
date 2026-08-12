// access.js — is this visitor logged in, and are they a paying member?
import { supabase } from "./account.js";

export async function getAccess() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { loggedIn: false, subscribed: false, user: null };
  let subscribed = false;
  try {
    const { data } = await supabase.from("profiles").select("subscribed").eq("id", user.id).maybeSingle();
    subscribed = !!(data && data.subscribed);
  } catch (e) {}
  return { loggedIn: true, subscribed, user };
}

export async function accessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? session.access_token : null;
}
