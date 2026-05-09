import { createServerClient } from "@supabase/ssr";
import { createBrowserClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Browser Client (client components) ───────────────────────────────────────
export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

// ─── Server Client (server components / API routes) ───────────────────────────
// When `extendedSession` is true, Supabase auth cookies are pinned to a 30-day
// max-age (vs the default ~7-day refresh token TTL) to support "Remember me".
export async function createServerSupabaseClient(opts?: { extendedSession?: boolean }) {
  const cookieStore = await cookies();
  const extendedSession = opts?.extendedSession === true;
  const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            const finalOptions = extendedSession && name.startsWith("sb-")
              ? { ...options, maxAge: REMEMBER_MAX_AGE }
              : options;
            cookieStore.set(name, value, finalOptions);
          });
        } catch {
          // setAll called from Server Component — cookies are read-only
        }
      },
    },
  });
}

// ─── Admin/Service Role Client (elevated access) ──────────────────────────────
export function createServiceSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseServiceKey);
}
