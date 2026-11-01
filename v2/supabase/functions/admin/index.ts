import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration missing" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user) return json({ error: "Invalid session" }, 401);
  if (user.app_metadata?.role !== "owner_admin") return json({ error: "Owner administrator only" }, 403);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = body.action;

  if (action === "list_users") {
    const { data: profiles, error } = await admin.from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) return json({ error: error.message }, 400);
    return json({ profiles });
  }
  if (action === "set_approval") {
    const id = typeof body.user_id === "string" ? body.user_id : "";
    const status = body.status;
    if (!id || !["approved", "rejected", "suspended"].includes(String(status))) return json({ error: "Invalid user or status" }, 400);
    const { data, error } = await admin.from("profiles").update({ approval_status: status, updated_at: new Date().toISOString() }).eq("id", id).select("id,approval_status").single();
    if (error) return json({ error: error.message }, 400);
    await admin.from("admin_audit_log").insert({ actor_id: user.id, action: `user_${status}`, target_user_id: id });
    return json({ profile: data });
  }
  if (action === "save_content") {
    const id = typeof body.id === "string" ? body.id : null;
    const item = body.item as Record<string, unknown> | undefined;
    if (!item || !["he", "en", "th"].includes(String(item.learning_language)) ||
        !["he", "en", "th"].includes(String(item.translation_language)) ||
        item.learning_language === item.translation_language ||
        !["word", "sentence"].includes(String(item.item_type)) ||
        typeof item.source_text !== "string" || !item.source_text.trim() ||
        typeof item.translation_text !== "string" || !item.translation_text.trim()) {
      return json({ error: "Invalid content item" }, 400);
    }
    const safe = {
      learning_language: item.learning_language, translation_language: item.translation_language,
      item_type: item.item_type, category: String(item.category ?? "general").slice(0, 80),
      source_text: item.source_text.slice(0, 1000), translation_text: item.translation_text.slice(0, 1000),
      transliteration: typeof item.transliteration === "string" ? item.transliteration.slice(0, 300) : null,
      audio_url: typeof item.audio_url === "string" ? item.audio_url.slice(0, 1000) : null,
      status: "draft", updated_by: user.id, updated_at: new Date().toISOString(),
    };
    const result = id
      ? await admin.from("content_items").update(safe).eq("id", id).select().single()
      : await admin.from("content_items").insert({ ...safe, created_by: user.id }).select().single();
    if (result.error) return json({ error: result.error.message }, 400);
    await admin.from("admin_audit_log").insert({ actor_id: user.id, action: id ? "content_updated" : "content_created", details: { content_id: result.data.id } });
    return json({ item: result.data });
  }
  if (action === "publish_content") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
    if (!ids.length) return json({ error: "Select at least one item" }, 400);
    const { data, error } = await admin.from("content_items").update({ status: "published", published_at: new Date().toISOString(), updated_by: user.id }).in("id", ids).select("id,status");
    if (error) return json({ error: error.message }, 400);
    await admin.from("admin_audit_log").insert({ actor_id: user.id, action: "content_published", details: { count: data.length } });
    return json({ published: data.length });
  }
  if (action === "dashboard_stats") {
    const [profiles, pending, active, content, tests] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
      admin.from("learning_events").select("user_id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      admin.from("content_items").select("id", { count: "exact", head: true }).eq("status", "published"),
      admin.from("test_results").select("score").order("completed_at", { ascending: false }).limit(500),
    ]);
    const scores = tests.data ?? [];
    const average = scores.length ? scores.reduce((sum, x) => sum + Number(x.score), 0) / scores.length : null;
    return json({ users: profiles.count ?? 0, pending: pending.count ?? 0, activity_events_7d: active.count ?? 0, published_content: content.count ?? 0, average_test_score: average });
  }
  return json({ error: "Unknown action" }, 400);
});
