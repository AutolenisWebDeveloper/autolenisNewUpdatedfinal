import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { BUYER_BACKWARD_SAFE_SELECT } from "@/lib/auth/buyer-select";

// Standard API response shapes
export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(code: string, message: string, status = 400) {
  return NextResponse.json(
    { error: { code, message }, correlationId: crypto.randomUUID() },
    { status }
  );
}

// Get authenticated user from request (for API routes)
export async function getRequestUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Explicit select used as a backward-safe fallback in case the lifecycle
// columns (archived_at / disabled_at / purged_at) are not yet present in the
// production database.  Required migration: 20260603000000_add_buyer_lifecycle_fields

// Get buyer record from authenticated request
export async function getRequestBuyer(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return null;

  try {
    return await prisma.buyer.findFirst({
      where: { user: { supabaseId: user.id } },
      include: { user: true, preQualification: true },
    });
  } catch (primaryErr) {
    // Migration 20260603000000_add_buyer_lifecycle_fields may not be applied yet.
    // Fall back to an explicit select that omits the lifecycle columns.
    console.error(
      "[auth/api] buyer query failed — trying backward-safe fallback.",
      primaryErr,
    );
    try {
      const row = await prisma.buyer.findFirst({
        where: { user: { supabaseId: user.id } },
        select: BUYER_BACKWARD_SAFE_SELECT,
      });
      if (!row) return null;
      return {
        ...row,
        archivedAt: null as Date | null,
        disabledAt: null as Date | null,
        purgedAt: null as Date | null,
      };
    } catch (fallbackErr) {
      console.error("[auth/api] backward-safe fallback also failed:", fallbackErr);
      return null;
    }
  }
}
