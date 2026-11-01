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
  assert.match(schema, /create table if not exists public\.test_results \([\s\S]*?id uuid primary key default gen_random_uuid\(\)/);
  assert.match(schema, /unique\(user_id, achievement_key\)/);
  assert.match(schema, /grant execute on function public\.consume_api_rate_limit\(uuid,text,integer,integer\) to service_role/);
});

test("edge function verifies owner role and computes learner achievements server-side", () => {
  assert.match(edge, /user\.app_metadata\?\.role !== "owner_admin"/);
  assert.match(edge, /body\.action === "sync_achievements"/);
  assert.match(edge, /from\("user_progress"\)\.select\("content_item_id", \{ count: "exact", head: true \}\)/);
  assert.match(edge, /from\("user_achievements"\)/);
  assert.match(edge, /enforceRateLimit/);
});

test("offline support caches SDK and queues private learner progress", () => {
  assert.match(sw, /lingua-v2-shell-5/);
  assert.match(sw, /SUPABASE_SDK/);
  assert.match(app, /function syncOfflineQueue\(/);
  assert.match(app, /progressQueueKey/);
  assert.match(app, /writeLocal\('content:/);
  assert.match(app, /נשמר במכשיר/);
  assert.match(app, /מצב לא מקוון/);
});

test("offline reconnect sync preserves quiz results and quiz-earned progress", () => {
  assert.match(app, /test-queue:'\+currentUser\.id/);
  assert.match(app, /from\('test_results'\)\.insert\(result\)/);
  assert.match(app, /crypto\.randomUUID\(\)/);
  assert.match(app, /syncingOfflineQueue/);
  assert.match(app, /Quiz progress saved locally after sync error/);
  assert.match(app, /Math\.max\(row\.mastery\|\|0,remote\?\.mastery\|\|0\)/);
  assert.match(app, /Math\.max\(row\.times_seen\|\|0,remote\?\.times_seen\|\|0\)/);
});

test("offline quiz fallback does not double-increment locally saved progress", () => {
  assert.match(app, /const row=local\[item\.id\]\|\|\{user_id:currentUser\.id,content_item_id:item\.id,mastery:1,times_seen:1,times_correct:1/);
  assert.doesNotMatch(app, /Quiz progress saved locally after sync error'[\s\S]{0,500}mastery:Math\.min\(5,\(local\[item\.id\]\?\.mastery\|\|0\)\+1\)/);
});

test("learner statistics merge remote data with local pending progress and test queues", () => {
  assert.match(app, /const localProgress=Object\.values\(readLocal\('progress:'/);
  assert.match(app, /const pendingTests=readLocal\('test-queue:'/);
  assert.match(app, /new Map\(\[\.\.\.testRows,\.\.\.localTests,\.\.\.pendingTests\]/);
});
