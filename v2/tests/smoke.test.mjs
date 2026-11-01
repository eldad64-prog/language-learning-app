import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, app, schema, edge, sw] = await Promise.all([
  read("../index.html"), read("../app.js"), read("../supabase-schema.sql"),
  read("../supabase/functions/admin/index.ts"), read("../sw.js"),
]);

test("learner UI exposes language settings and private achievements", () => {
  assert.match(html, /id="learnerLearning"/);
  assert.match(html, /id="learnerTranslation"/);
  assert.match(html, /id="saveLanguagePair"/);
  assert.match(html, /id="achievementsList"/);
  assert.match(app, /data-edit-draft/);
});

test("learner app saves preferences, progress, quizzes and achievement sync", () => {
  assert.match(app, /from\('profiles'\)\.update\(\{learning_language:nextLearning,translation_language:nextTranslation\}\)/);
  assert.match(app, /onConflict:'user_id,content_item_id'/);
  assert.match(app, /action:'sync_achievements'/);
  assert.match(app, /function loadAchievements\(/);
  assert.match(app, /slice\(0,Math\.min\(10,learningItems\.length\)\)/);
});

test("database schema protects private data and has server-only rate limiting", () => {
  for (const table of ["profiles", "content_items", "user_progress", "test_results", "learning_events", "admin_audit_log", "user_achievements"]) {
    assert.match(schema, new RegExp("alter table public\\." + table + " enable row level security"));
  }
  assert.match(schema, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(schema, /grant execute on function public\.consume_api_rate_limit\(uuid,text,integer,integer\) to service_role/);
});

test("edge function verifies owner role and computes learner achievements server-side", () => {
  assert.match(edge, /user\.app_metadata\?\.role !== "owner_admin"/);
  assert.match(edge, /body\.action === "sync_achievements"/);
  assert.match(edge, /from\("user_progress"\)\.select\("content_item_id", \{ count: "exact", head: true \}\)/);
  assert.match(edge, /from\("user_achievements"\)/);
  assert.match(edge, /enforceRateLimit/);
});

test("service worker keeps a versioned local app shell", () => {
  assert.match(sw, /lingua-v2-shell-/);
  assert.match(sw, /'\.\/app\.js'/);
});
