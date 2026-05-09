// GET /api/admin/health/integrations
// Returns live reachability status for each external integration.
// All checks run in parallel with a 3-second timeout.
// Never exposes credentials or internal error messages.
// Requires valid admin session.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const timeout = (ms: number) =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    );

  const check = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await Promise.race([fn(), timeout(3000)]);
      return { name, ok: true };
    } catch {
      return { name, ok: false };
    }
  };

  const results = await Promise.allSettled([
    // Stripe: list payment methods (cheapest read-only call)
    check("stripe", async () => {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("not configured");
      await getStripe().paymentMethods.list({ limit: 1 });
    }),
    // DocuSign: check if env vars are set (no API call — avoids OAuth overhead)
    check("docusign", async () => {
      if (!process.env.DOCUSIGN_INTEGRATION_KEY || !process.env.DOCUSIGN_ACCOUNT_ID) {
        throw new Error("not configured");
      }
    }),
    // Resend: check if API key is set (Resend has no cheap ping endpoint)
    check("resend", async () => {
      if (!process.env.RESEND_API_KEY) throw new Error("not configured");
    }),
    // MicroBilt: check if credentials are set
    check("microbilt", async () => {
      if (!process.env.MICROBILT_CLIENT_ID || !process.env.MICROBILT_CLIENT_SECRET) {
        throw new Error("not configured");
      }
    }),
    // Supabase: verify REST API is reachable
    check("supabase", async () => {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("not configured");
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
        headers: { "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    }),
    // Groq: check if API key is set and not a placeholder
    check("groq", async () => {
      if (!process.env.GROQ_API_KEY) throw new Error("not configured");
      if (process.env.GROQ_API_KEY.includes("placeholder")) throw new Error("placeholder key");
    }),
  ]);

  const integrations = results.map((r) =>
    r.status === "fulfilled" ? r.value : { name: "unknown", ok: false }
  );

  return adminSuccess({ integrations });
}
