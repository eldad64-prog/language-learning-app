# Language Learning App — V2

This directory is the isolated V2 workspace. The existing production app at the repository root is intentionally untouched.

## Product decisions
- Three selectable learning languages: Hebrew (he), English (en), Thai (th).
- Each account independently selects a learning language and a translation language.
- Self-service registration; every new account starts as pending approval.
- Exactly one owner-controlled administrator. Public registration must never grant admin privileges.
- Shared centrally managed learning content, with draft/review/publish workflow.
- Personal learning progress, test results, achievements, and usage remain scoped to each account.
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
V2 UI prototype and first Supabase schema/RLS baseline have been committed on the isolated development branch. PWA shell caching files are included. The app is NOT production-ready: Supabase project URL/public key are not configured, the SQL has not been applied or security-tested, and signup/login/approval/admin actions are placeholders until trusted backend functions are deployed. No credentials have been added.