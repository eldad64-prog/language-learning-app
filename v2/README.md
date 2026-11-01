# Language Learning App — V2

This directory is the isolated V2 workspace. The existing production app at the repository root is intentionally untouched.

## Product decisions
- Three selectable learning languages: Hebrew (he), English (en), Thai (th).
- Each account independently selects a learning language and a translation language.
- Self-service registration; every new account starts as pending approval.
- Exactly one owner-controlled administrator. Public registration must never grant admin privileges.
- Shared centrally managed learning content, with draft/review/publish workflow.
- Personal learning progress, test results, achievements, and usage remain scoped to each account.
- Learner workspace includes published word/sentence feeds, device speech playback, per-item progress, randomized short quizzes (up to 10 questions), editable language-pair preferences, a private achievements list awarded by server-side evaluation, and owner editing of saved content drafts.
- Owner dashboard shows aggregate users, pending approvals, weekly activity events, published content, and average test score; per-user details include language pair, approval state, last activity, last login, learned-item count, recorded study minutes, test count, and average score. Study duration is recorded when a learner leaves or backgrounds the app; very short sessions may not be recorded.
- Achievements are stored in a separate private table; only trusted server-side processes may award them.
- Owner-only aggregate and per-user administration dashboard.
- New app must be tested separately before any production cutover.

## Security requirements
- Supabase Auth for identity; never store plaintext passwords.
- Public client may contain only the Supabase project URL and publishable/anon key.
- Never place service-role/secret keys in browser code, GitHub Pages, or a PWA bundle.
- Enforce approval, roles, and row-level access in PostgreSQL/RLS and trusted server-side functions; UI hiding is not authorization.
- Users may read/write only their own profile and progress.
- Approved users may read published shared content; only the owner-admin may create, edit, approve, or publish shared content.
- Admin identity must be provisioned out-of-band using a trusted server-side process; never from a client-supplied role field.
- Collect only necessary usage analytics; disclose admin visibility to users and provide an appropriate privacy notice.
- Request device permissions only when a feature needs them, with explicit user consent.
- Use HTTPS, secure session handling, input validation, rate limiting, backups, and audit logs.

## Suggested data model
- profiles: auth user UUID, display name, approval status (pending/approved/rejected/suspended), learning language, translation language, timestamps.
- content_items: language pair, category, source text, translation, transliteration/audio metadata, publication status, version and timestamps.
- learning_events: user UUID, content item UUID, event type, score/duration metadata, timestamp.
- user_progress: user UUID, content item UUID, mastery/review state, updated timestamp.
- admin_audit_log: actor UUID, action, target, timestamp, minimal metadata.

All user-owned tables require RLS policies tied to auth.uid(). Admin operations must use a verified server-side admin claim or protected database role check, not a client-writable profile flag.

## Release approach
1. Inspect the existing app and preserve it.
2. Build V2 only in this directory and on branch v2-platform-development.
3. Configure Supabase only after the project URL and safe public key are available; secrets stay server-side.
4. Test registration, pending approval, approval/rejection, user isolation, admin-only operations, language preferences, sync, and PWA behavior.
5. Deploy V2 to a separate preview URL.
6. Keep the current production app unchanged until the owner explicitly approves a cutover.

## Current status
V2 registration/login/admin UI and a first learner workspace are committed on the isolated development branch. The browser configuration contains only the Supabase project URL and publishable key; no service-role or secret key is present. The SQL and Edge Function have NOT been deployed or security-tested, so registration, approval, content delivery, progress sync, and quizzes cannot be considered live until the database migration and server function are deployed and tested. GitHub Actions checks JavaScript syntax, Deno type-checks the Edge Function, scans browser files for server secrets, and verifies required files. A green CI run does not validate live Supabase behavior.
## Remaining release blockers

- Apply and review `supabase-schema.sql`, `supabase-achievements-migration.sql`, and `supabase-rate-limits-migration.sql` in the intended Supabase project (the main schema already includes the latter objects; the separate migrations are safe for incremental setups).
- Deploy the `admin` Edge Function and configure server-only secrets, including the exact `APP_ORIGIN`.
- Verify the owner's Auth UUID, provision the immutable `owner_admin` app-metadata claim out-of-band, and approve that profile.
- Perform end-to-end tests for signup/email verification, pending/approved/rejected/suspended access, RLS isolation, language changes, content draft/publish, progress, quiz scoring, and mobile PWA behavior.
- Validate the implemented offline app-shell/SDK cache, per-user content cache, local progress queue and reconnect sync on Android/iPhone; test conflict handling, quota behavior and expired sessions before describing offline learning as fully supported.
- Build and review the requested multilingual content library; no large content set is auto-published by this branch.
- Verify the current PWA shell on Android and iPhone after cache version `lingua-v2-shell-5`; this now includes an SDK cache and a first local content/progress queue implementation, but requires real-device and sync-conflict validation.

The production root app and `main` branch remain unchanged. Do not merge the draft PR until all release blockers are cleared.
