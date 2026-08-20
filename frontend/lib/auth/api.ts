import { logger } from "@/lib/logger";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";
import { BUYER_BACKWARD_SAFE_SELECT } from "@/lib/auth/buyer-select";
import { isBuyerAccessDisabled } from "@/lib/auth/buyer-status";

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

// Get authenticated user from request (for API routes).
//
// Supabase may rotate the access/refresh token pair when `getUser()` runs near
// expiry. We forward those rotated cookies into Next's mutable cookie store so
// the next request on the same session keeps working — silently dropping them
// (as an empty setAll() does) eventually 401s the buyer mid-session.
export async function getRequestUser(request: NextRequest) {
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
            // Called from a context where cookies are read-only (e.g. a GET
            // server component). Safe to ignore — the next mutating call will
            // persist the refreshed token.
          }
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Explicit select used as a backward-safe fallback in case the lifecycle
// columns (archived_at / disabled_at / purged_at) are not yet present in the
// production database.  Required migration: 20260603000000_add_buyer_lifecycle_fields

// Load the buyer for a Supabase user id and apply the shared access-status gate.
//
// P0 authorization boundary: a buyer whose access an admin has disabled
// (`disabledAt`) or whose PII was purged (`purgedAt`) is treated as
// unauthorized here — the function returns null so every `/api/buyer/*` route
// (all of which 401 on a null buyer) denies the request. This mirrors the
// dealer `requireDealerFromRequest` BLOCKED_STATUSES precedent and is enforced
// centrally rather than per-route.
//
// Exported so the invariant is unit-testable without the Supabase/next-headers
// stack that `getRequestBuyer` needs to resolve the user.
export async function resolveAuthorizedBuyer(supabaseUserId: string) {
  try {
    const buyer = await prisma.buyer.findFirst({
      where: { user: { supabaseId: supabaseUserId } },
      include: { user: true, preQualification: true },
    });
    if (!buyer) return null;
    // Deny disabled/purged buyers at the shared boundary.
    if (isBuyerAccessDisabled(buyer)) return null;
    return buyer;
  } catch (primaryErr) {
    // Migration 20260603000000_add_buyer_lifecycle_fields may not be applied yet.
    // Fall back to an explicit select that omits the lifecycle columns.
    //
    // NOTE (documented prod-dependency): in this degraded pre-migration state the
    // disabled/purged columns are unreadable, so this path CANNOT enforce the
    // disable gate and returns the buyer with null lifecycle fields. Full
    // buyer-disable enforcement therefore REQUIRES the lifecycle migration to be
    // applied in the target environment.
    logger.error(
      "[auth/api] buyer query failed — trying backward-safe fallback.",
      primaryErr,
    );
    try {
      const row = await prisma.buyer.findFirst({
        where: { user: { supabaseId: supabaseUserId } },
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
      logger.error("[auth/api] backward-safe fallback also failed:", fallbackErr);
      return null;
    }
  }
}

// Get buyer record from authenticated request
export async function getRequestBuyer(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return null;
  return resolveAuthorizedBuyer(user.id);
}
