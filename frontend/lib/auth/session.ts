import { logger } from "@/lib/logger";
import { createServerSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { BUYER_BACKWARD_SAFE_SELECT } from "@/lib/auth/buyer-select";

// ─── Get current authenticated buyer ───────────────────────────────────────

export async function getAuthenticatedBuyer() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Defense-in-depth: even if a session cookie exists, refuse to load buyer
  // data for an unverified email. signInWithPassword already gates on this,
  // but a forged or stale cookie should not be enough to load /buyer/*.
  if (!user.email_confirmed_at) return null;

  try {
    return await prisma.buyer.findFirst({
      where: { user: { supabaseId: user.id } },
      include: { user: true, preQualification: true },
    });
  } catch (primaryErr) {
    // The production database may be missing the recently-added lifecycle
    // columns (archived_at, disabled_at, purged_at).  Retry with an explicit
    // select that omits those columns so the buyer portal keeps working while
    // the migration is being applied.
    // Required migration: 20260603000000_add_buyer_lifecycle_fields
    logger.error(
      "[auth/session] buyer query failed — possible schema mismatch " +
        "(migration 20260603000000_add_buyer_lifecycle_fields may not be applied). " +
        "Retrying with backward-safe fallback.",
      primaryErr,
    );
    try {
      const row = await prisma.buyer.findFirst({
        where: { user: { supabaseId: user.id } },
        select: BUYER_BACKWARD_SAFE_SELECT,
      });
      if (!row) return null;
      // Lifecycle fields are absent from the DB row; supply null defaults so
      // the rest of the codebase can treat them as nullable without crashing.
      // Buyer-facing code never reads archivedAt / disabledAt / purgedAt.
      return {
        ...row,
        archivedAt: null as Date | null,
        disabledAt: null as Date | null,
        purgedAt: null as Date | null,
      };
    } catch (fallbackErr) {
      logger.error("[auth/session] backward-safe fallback also failed:", fallbackErr);
      return null;
    }
  }
}

// ─── Require authenticated buyer (server component helper) ─────────────────

export async function requireBuyer() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  // Unverified buyer with a valid session — route to the verification screen
  // rather than silently signing them out at the buyer dashboard.
  if (!user.email_confirmed_at) redirect("/auth/verify-email");

  let buyer = await getAuthenticatedBuyer();

  // No Prisma Buyer for a verified, authenticated Supabase user means the
  // auth-callback provisioning never completed. Redirecting to /auth/signin here
  // produced an inescapable ping-pong: proxy.ts step 9 bounces an authenticated
  // user OFF /auth/signin back to /buyer/dashboard, which lands here again.
  // Production holds two such accounts, and they can currently never reach the
  // portal or see any explanation.
  //
  // Heal through the SAME provisioning path the auth callback uses
  // (ensurePrismaUser is idempotent and returns an existing row untouched)
  // rather than adding a second account-creation path, then re-read.
  if (!buyer && user.email) {
    const role = (user.user_metadata?.role as string | undefined) ?? "BUYER";
    if (role === "BUYER") {
      try {
        const { ensurePrismaUser } = await import("@/lib/auth/actions");
        const { UserRole, BuyerPlan } = await import("@prisma/client");
        await ensurePrismaUser(
          user.id,
          user.email,
          UserRole.BUYER,
          user.user_metadata?.plan === "PREMIUM" ? BuyerPlan.PREMIUM : BuyerPlan.STANDARD,
          user.user_metadata?.firstName as string | undefined,
          user.user_metadata?.lastName as string | undefined,
          (user.user_metadata?.termsAcceptedAt as string | undefined) ?? null,
          (user.user_metadata?.termsVersion as string | undefined) ?? null,
        );
        buyer = await getAuthenticatedBuyer();
      } catch (err) {
        logger.error("[auth/session] buyer self-heal failed:", err);
      }
    }
  }

  // Still nothing: send them somewhere that is NOT an auth route (so proxy.ts
  // cannot bounce them straight back into the loop) and that offers sign-out —
  // the one action that reliably escapes a broken authenticated state.
  if (!buyer) redirect("/auth/unauthorized?reason=account_setup");
  if (buyer.isSuspended) redirect("/buyer/suspended");
  return buyer;
}

// ─── Get current supabase user ─────────────────────────────────────────────

export async function getUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
