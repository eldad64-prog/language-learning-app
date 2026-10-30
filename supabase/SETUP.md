# Supabase setup — Language Learning

This setup belongs to the **Language Learning** Supabase project only. Do not run it in the Loan Management project.

## What is prepared
- `migrations/0001_initial_schema.sql`: profiles, shared learning catalog, private progress, custom items, test results, settings, and a private voice-recording bucket.
- Row Level Security is enabled on every application table.
- Learner-owned rows are restricted to the signed-in user's `auth.uid()`.
- The learning catalog is read-only to signed-in learners.

## One-time Supabase action
1. Open the **Language Learning** project in Supabase.
2. Open **SQL Editor** and create a new query.
3. Copy the complete contents of `supabase/migrations/0001_initial_schema.sql` from this branch.
4. Run it once. If Supabase reports an error, stop and share the exact error text; do not rerun blindly.

## Auth setup
- Create one Supabase Auth account for each learner (Eldad and Liora).
- Use separate login credentials for the two accounts. Do not share one account between phones.
- Set each account's user metadata `display_name` to the learner's display name. The profile row is created automatically on signup.
- For production, enable email confirmation or another appropriate sign-in method.

## App configuration (public values only)
The web app will need:
- Supabase Project URL
- Supabase publishable key (or legacy anon key)

These values are designed to be used in a browser when RLS is correctly configured. **Never put the database password or service_role/secret key in HTML, JavaScript, GitHub, or chat.**

## Important separation and release safety
- The current production app on `main` is not modified by this setup branch.
- The migration must be applied only to the newly created Language Learning project.
- Do not merge this branch into `main` until the schema is applied and the app integration has been tested on both phones.
