// /api/buyer/requests/[requestId]/trade — Stage 4 trade election and packet (§4c, §6.2).
//
// PUT is both the create and the EDIT path, deliberately: a trade packet is entered before the
// buyer has looked up their payoff or found the second key, and a capture-once form produces a
// packet that is wrong by the time a dealer reads it.
//
// GET always returns the appraisal disclaimer, whether or not a packet exists, so no surface
// can render the figures without it.

import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import {
  recordTradeElection, getTradePacket,
  TRADE_APPRAISAL_DISCLAIMER, TRADE_PACKET_DISCLAIMER_VERSION,
} from "@/lib/services/trade-in/trade-in.service";

interface Props { params: Promise<{ requestId: string }> }

const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const LOAN_STATUSES = ["OWNED_OUTRIGHT", "FINANCED", "LEASED"] as const;

const schema = z.object({
  elected: z.boolean(),
  vin: z.string().max(17).optional().nullable(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  make: z.string().min(1).max(60).optional(),
  model: z.string().min(1).max(60).optional(),
  trim: z.string().max(60).optional().nullable(),
  mileage: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  condition: z.enum(CONDITIONS).optional(),
  loanStatus: z.enum(LOAN_STATUSES).optional().nullable(),
  loanBalanceCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  lienholderName: z.string().max(120).optional().nullable(),
  payoffGoodThroughDate: z.coerce.date().optional().nullable(),
  titleInHand: z.boolean().optional().nullable(),
  titleState: z.string().max(32).optional().nullable(),
  hasSecondKey: z.boolean().optional().nullable(),
  photoUrls: z.array(z.string().url()).max(12).optional(),
  notes: z.string().max(2000).optional().nullable(),
  shareConsent: z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { requestId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return successResponse({
    packet: await getTradePacket(buyer.id, requestId),
    // Present even when there is no packet: the surface that COLLECTS the figures has to show
    // it too, not only the one that displays them back.
    disclaimer: { text: TRADE_APPRAISAL_DISCLAIMER, version: TRADE_PACKET_DISCLAIMER_VERSION },
    conditions: CONDITIONS,
    loanStatuses: LOAN_STATUSES,
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

  const result = await recordTradeElection(
    buyer.id,
    requestId,
    d.elected,
    d.elected
      ? {
          vin: d.vin ?? null,
          year: d.year ?? 0,
          make: d.make ?? "",
          model: d.model ?? "",
          trim: d.trim ?? null,
          mileage: d.mileage ?? null,
          condition: d.condition ?? "GOOD",
          loanStatus: d.loanStatus ?? null,
          loanBalanceCents: d.loanBalanceCents ?? null,
          lienholderName: d.lienholderName ?? null,
          payoffGoodThroughDate: d.payoffGoodThroughDate ?? null,
          titleInHand: d.titleInHand ?? null,
          titleState: d.titleState ?? null,
          hasSecondKey: d.hasSecondKey ?? null,
          photoUrls: d.photoUrls ?? [],
          notes: d.notes ?? null,
          shareConsent: d.shareConsent === true,
        }
      : undefined,
  );

  if (!result.ok) {
    return errorResponse(result.code, result.message, result.code === "REQUEST_NOT_FOUND" ? 404 : 400);
  }
  // THE SAME SHAPE GET RETURNS, and the version is the reason it matters rather than tidiness.
  // PUT returned a bare string while GET returns `{ text, version }`, so a client that stored
  // what PUT handed back lost `TRADE_PACKET_DISCLAIMER_VERSION` — the one field §6.2 needs to
  // record WHICH appraisal disclaimer the buyer was shown. Found by review on the PR.
  return successResponse({
    elected: result.elected,
    packet: result.packet,
    disclaimer: { text: TRADE_APPRAISAL_DISCLAIMER, version: TRADE_PACKET_DISCLAIMER_VERSION },
  });
}
