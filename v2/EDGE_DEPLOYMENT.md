# Supabase Edge Function deployment

From the repository root, enter the V2 directory and deploy with Supabase CLI:

```bash
cd v2
supabase functions deploy admin
supabase secrets set SUPABASE_URL="https://ybwxcpblvsrjbazdueya.supabase.co" SUPABASE_ANON_KEY="<publishable-or-anon-key>" SUPABASE_SERVICE_ROLE_KEY="<server-only-service-role-key>"
```

The service-role key must be entered only into Supabase Edge Function secrets, never committed to GitHub or placed in browser code. Configure the first owner account out-of-band in Supabase SQL Editor using its verified auth UUID, as documented in `supabase-schema.sql`.

The endpoint verifies the JWT using Supabase Auth and checks the immutable `app_metadata.role = owner_admin` claim before any privileged action. It supports owner-only user listing, approval/rejection/suspension, content draft editing, batch publication, and aggregate dashboard metrics. Review and test policies and rate limits before production use.
