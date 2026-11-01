import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...(origin ? corsHeaders(origin) : {}), "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  const configuredOrigin = Deno.env.get("APP_ORIGIN");
  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!configuredOrigin || requestOrigin !== configuredOrigin) {
    return new Response("Origin not allowed", { status: 403 });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(requestOrigin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, requestOrigin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration missing" }, 500, requestOrigin);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required" }, 401, requestOrigin);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user) return json({ error: "Invalid session" }, 401, requestOrigin);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const enforceRateLimit = async (action: "admin" | "sync_achievements", limit: number) => {
    const { data, error } = await admin.rpc("consume_api_rate_limit", {
      p_user_id: user.id, p_action: action, p_limit: limit, p_window_seconds: 60,
    });
    if (error) {
      console.error("Rate limit check failed:", error.message);
      return false;
    }
    return data === true;
  };
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, requestOrigin); }

  // Learners may request achievement evaluation for their own approved account only.
  // All counters are recomputed server-side; client-supplied progress is never trusted.
  if (body.action === "sync_achievements") {
    if (!await enforceRateLimit("sync_achievements", 20)) return json({ error: "Too many requests. Please wait one minute." }, 429, requestOrigin);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("approval_status").eq("id", user.id).maybeSingle();
    if (profileError || profile?.approval_status !== "approved") {
      return json({ error: "Approved learner account required" }, 403, requestOrigin);
    }
    const [progress, tests, best] = await Promise.all([
      admin.from("user_progress").select("content_item_id", { count: "exact", head: true })
        .eq("user_id", user.id).gte("mastery", 3),
      admin.from("test_results").select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      admin.from("test_results").select("score").eq("user_id", user.id)
        .order("score", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (progress.error || tests.error || best.error) return json({ error: "Unable to evaluate achievements" }, 400, requestOrigin);
    const learned = progress.count ?? 0;
    const testCount = tests.count ?? 0;
    const bestScore = Number(best.data?.score ?? 0);
    const candidates = [
      { key: "first_item", title: "הצעד הראשון", description: "למדת את הפריט הראשון שלך", earned: learned >= 1 },
      { key: "learner_10", title: "מתחילים להתקדם", description: "למדת 10 פריטים", earned: learned >= 10 },
      { key: "learner_50", title: "לומד מתמיד", description: "למדת 50 פריטים", earned: learned >= 50 },
      { key: "learner_100", title: "מאה הצלחות", description: "למדת 100 פריטים", earned: learned >= 100 },
      { key: "first_test", title: "נבחן בפעם הראשונה", description: "השלמת את המבחן הראשון", earned: testCount >= 1 },
      { key: "tests_10", title: "מתרגל בקביעות", description: "השלמת 10 מבחנים", earned: testCount >= 10 },
      { key: "perfect_score", title: "ציון מושלם", description: "קיבלת 100% במבחן", earned: bestScore >= 100 },
    ].filter((x) => x.earned);
    if (!candidates.length) return json({ awarded: 0 }, 200, requestOrigin);
    const { data, error } = await admin.from("user_achievements")
      .upsert(candidates.map(({ key, title, description }) => ({
        user_id: user.id, achievement_key: key, title, description,
      })), { onConflict: "user_id,achievement_key", ignoreDuplicates: true })
      .select("achievement_key");
    if (error) return json({ error: "Unable to save achievements" }, 400, requestOrigin);
    if ((data ?? []).length) {
      await admin.from("learning_events").insert({
        user_id: user.id, event_type: "achievement",
        metadata: { achievement_keys: data.map((x) => x.achievement_key) },
      });
    }
    return json({ awarded: (data ?? []).length }, 200, requestOrigin);
  }

  if (user.app_metadata?.role !== "owner_admin") return json({ error: "Owner administrator only" }, 403, requestOrigin);
  if (!await enforceRateLimit("admin", 60)) return json({ error: "Too many requests. Please wait one minute." }, 429, requestOrigin);
  const action = body.action;

  if (action === "list_users") {
    const { data: profiles, error } = await admin.from("profiles").select("id,display_name,learning_language,translation_language,approval_status,created_at").order("created_at", { ascending: false }).limit(500);
    if (error) return json({ error: error.message }, 400, requestOrigin);
    const ids = (profiles ?? []).map((p) => p.id);
    if (!ids.length) return json({ profiles: [] }, 200, requestOrigin);
    const [events, progress, tests] = await Promise.all([
      admin.from("learning_events").select("user_id,event_type,duration_seconds,created_at").in("user_id", ids).order("created_at", { ascending: false }).limit(10000),
      admin.from("user_progress").select("user_id,mastery").in("user_id", ids).limit(20000),
      admin.from("test_results").select("user_id,score,completed_at").in("user_id", ids).order("completed_at", { ascending: false }).limit(10000),
    ]);
    if (events.error || progress.error || tests.error) return json({ error: "Unable to load user activity metrics" }, 400, requestOrigin);
    const metrics = new Map<string, {lastActive:string|null,lastLogin:string|null,seconds:number,learned:number,scores:number[],tests:number}>();
    for (const id of ids) metrics.set(id,{lastActive:null,lastLogin:null,seconds:0,learned:0,scores:[],tests:0});
    for (const x of events.data ?? []) { const m=metrics.get(x.user_id); if(!m)continue; if(!m.lastActive)m.lastActive=x.created_at; if(x.event_type==="login"&&!m.lastLogin)m.lastLogin=x.created_at; m.seconds+=Number(x.duration_seconds??0); }
    for (const x of progress.data ?? []) { const m=metrics.get(x.user_id); if(m && Number(x.mastery)>=3)m.learned++; }
    for (const x of tests.data ?? []) { const m=metrics.get(x.user_id); if(m){m.tests++; if(m.scores.length<100)m.scores.push(Number(x.score));} }
    const enriched=(profiles??[]).map(p=>{const m=metrics.get(p.id)!;return {...p,last_active:m.lastActive,last_login:m.lastLogin,learned_count:m.learned,study_minutes:Math.round(m.seconds/60),test_count:m.tests,average_test_score:m.scores.length?Math.round(m.scores.reduce((a,b)=>a+b,0)/m.scores.length):null};});
    return json({ profiles: enriched }, 200, requestOrigin);
  }
  if (action === "set_approval") {
    const id = typeof body.user_id === "string" ? body.user_id : "";
    const status = body.status;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        id === user.id || !["approved", "rejected", "suspended"].includes(String(status))) {
      return json({ error: "Invalid user or status" }, 400, requestOrigin);
    }
    const { data, error } = await admin.from("profiles").update({ approval_status: status, updated_at: new Date().toISOString() }).eq("id", id).select("id,approval_status").single();
    if (error) return json({ error: error.message }, 400, requestOrigin);
    const { error: auditError } = await admin.from("admin_audit_log").insert({ actor_id: user.id, action: `user_${status}`, target_user_id: id });
    if (auditError) console.error("Audit log write failed:", auditError.message);
    return json({ profile: data }, 200, requestOrigin);
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
      return json({ error: "Invalid content item" }, 400, requestOrigin);
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
    if (result.error) return json({ error: result.error.message }, 400, requestOrigin);
    const { error: auditError } = await admin.from("admin_audit_log").insert({ actor_id: user.id, action: id ? "content_updated" : "content_created", details: { content_id: result.data.id } });
    if (auditError) console.error("Audit log write failed:", auditError.message);
    return json({ item: result.data }, 200, requestOrigin);
  }
  if (action === "publish_content") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
    if (!ids.length) return json({ error: "Select at least one item" }, 400, requestOrigin);
    const { data, error } = await admin.from("content_items").update({ status: "published", published_at: new Date().toISOString(), updated_by: user.id }).in("id", ids).eq("status", "draft").select("id,status");
    if (error) return json({ error: error.message }, 400, requestOrigin);
    const { error: auditError } = await admin.from("admin_audit_log").insert({ actor_id: user.id, action: "content_published", details: { count: data.length } });
    if (auditError) console.error("Audit log write failed:", auditError.message);
    return json({ published: data.length }, 200, requestOrigin);
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
    return json({ users: profiles.count ?? 0, pending: pending.count ?? 0, activity_events_7d: active.count ?? 0, published_content: content.count ?? 0, average_test_score: average }, 200, requestOrigin);
  }
  return json({ error: "Unknown action" }, 400, requestOrigin);
});
