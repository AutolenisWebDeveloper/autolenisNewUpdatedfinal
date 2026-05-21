import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for admin CRM API routes. Bypasses RLS — only
// call from server-side admin endpoints that have already validated session.
export function getServiceSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
