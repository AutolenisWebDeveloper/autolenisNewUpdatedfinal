import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
export function errorResponse(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message }, correlationId: crypto.randomUUID() }, { status });
}

// R5 — Supabase may rotate the access/refresh token pair when getUser() runs
// near expiry. Forward those rotated cookies into Next's mutable cookie store
// (same pattern as getRequestUser in lib/auth/api.ts) — the previous no-op
// setAll silently dropped them and eventually 401'd the affiliate mid-session.
export async function getRequestAffiliate(request: NextRequest) {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Read-only cookie context (e.g. a GET server component). Safe to
            // ignore — the next mutating call persists the refreshed token.
          }
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const affiliate = await prisma.affiliate.findFirst({
    where: { user: { supabaseId: user.id } },
    include: { user: true },
  });

  if (!affiliate) return null;

  if (affiliate.status === "SUSPENDED" || affiliate.status === "REJECTED") {
    return null;
  }

  return affiliate;
}
