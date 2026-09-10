// /api/buyer/requests/[requestId]/co-buyer — Stage 4 co-buyer election (§4c, §6.2).
//
// Thin. Every rule — consent before PII, no identity numbers, "no" is an answer, the request
// must be open and the buyer's — lives in `lib/services/buyer/co-buyer.service.ts`.
//
// The raw body is passed to the service ALONGSIDE the parsed input on purpose. Zod strips
// unknown keys, so a client sending `ssn` would have it silently dropped and would believe it
// was stored; the service inspects the raw object and REFUSES instead.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import {
  recordCoBuyerElection, getCoBuyer, CO_BUYER_ROLES,
  CO_BUYER_SHARE_CONSENT_TEXT, CO_BUYER_SHARE_CONSENT_VERSION,
} from "@/lib/services/buyer/co-buyer.service";

interface Props { params: Promise<{ requestId: string }> }

const schema = z.object({
  elected: z.boolean(),
  legalFirstName: z.string().min(1).max(100).optional(),
  legalLastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().min(7).max(32).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(32).optional().nullable(),
  zip: z.string().max(12).optional().nullable(),
  role: z.enum(CO_BUYER_ROLES).optional().nullable(),
  isRequiredSigner: z.boolean().optional(),
  shareConsent: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return successResponse({
    coBuyer: await getCoBuyer(buyer.id, requestId),
    consent: { text: CO_BUYER_SHARE_CONSENT_TEXT, version: CO_BUYER_SHARE_CONSENT_VERSION },
    roles: CO_BUYER_ROLES,
  });
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let raw: unknown;
  try { raw = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const d = parsed.data;

  const result = await recordCoBuyerElection(
    buyer.id,
    requestId,
    d.elected,
    d.elected
      ? {
          legalFirstName: d.legalFirstName ?? "",
          legalLastName: d.legalLastName ?? "",
          email: d.email ?? null,
          phone: d.phone ?? null,
          address: d.address ?? null,
          city: d.city ?? null,
          state: d.state ?? null,
          zip: d.zip ?? null,
          role: d.role ?? null,
          isRequiredSigner: d.isRequiredSigner === true,
          shareConsent: d.shareConsent === true,
        }
      : undefined,
    raw,
  );

  if (!result.ok) {
    return errorResponse(result.code, result.message, result.code === "REQUEST_NOT_FOUND" ? 404 : 400);
  }
  return successResponse({ elected: result.elected, coBuyer: result.coBuyer });
}
