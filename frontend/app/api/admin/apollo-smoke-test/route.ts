// DISPOSABLE Apollo smoke-test endpoint — preview/local only, token-gated.
//
// One-off diagnostic to set the Apollo credit cap by running a single live People
// Search from a Vercel preview (where APOLLO_API_KEY + outbound network exist).
// NOT a product feature — makes exactly one read-only call, persists nothing, never
// touches the credit ledger, never enables the tier. DELETE this route once the cap
// is set. All logic lives in the service; this handler only reads env/headers.
//
// Gates: (1) 404 in production, always; (2) 403 unless x-smoke-token (or ?token=)
// equals SMOKE_TEST_TOKEN; (3) fail-closed JSON if APOLLO_API_KEY is absent.
import { NextRequest, NextResponse } from "next/server";
import {
  evaluateSmokeGates,
  runApolloPeopleSearchSmoke,
} from "@/lib/services/dealer-recruitment/apollo-smoke.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Overridable via ?domain= — default is a well-known dealership domain.
const DEFAULT_DOMAIN = "longotoyota.com";

export async function GET(request: NextRequest) {
  const gate = evaluateSmokeGates({
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    providedToken: request.headers.get("x-smoke-token") ?? request.nextUrl.searchParams.get("token"),
    expectedToken: process.env.SMOKE_TEST_TOKEN,
  });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, keyPresent: false, error: "APOLLO_API_KEY is not set in this environment" },
      { status: 200 },
    );
  }

  const domain = (request.nextUrl.searchParams.get("domain") || DEFAULT_DOMAIN).trim();
  const result = await runApolloPeopleSearchSmoke({ apiKey, domain });
  return NextResponse.json({ keyPresent: true, ...result }, { status: 200 });
}
