import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  method: z.enum(["CHECK", "ACH", "PAYPAL", "ZELLE"]),
  bankName: z.string().max(120).optional(),
  accountType: z.enum(["CHECKING", "SAVINGS"]).optional(),
  routingNumber: z.string().min(9).max(9).regex(/^\d{9}$/, "Routing number must be 9 digits").optional(),
  accountNumber: z.string().min(4).max(17).regex(/^\d+$/, "Account number must be numeric").optional(),
  zelleEmail: z.string().email().optional(),
  paypalEmail: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { routingNumber, accountNumber, ...rest } = parsed.data;

  // Extract last 4 digits only — never store or log full numbers
  const routingNumberLast4 = routingNumber ? routingNumber.slice(-4) : undefined;
  const accountNumberLast4 = accountNumber ? accountNumber.slice(-4) : undefined;

  const record = await prisma.affiliatePayoutMethod.upsert({
    where: { affiliateId: affiliate.id },
    create: {
      affiliateId: affiliate.id,
      method: rest.method,
      bankName: rest.bankName ?? null,
      accountType: rest.accountType ?? null,
      routingNumberLast4: routingNumberLast4 ?? null,
      accountNumberLast4: accountNumberLast4 ?? null,
      zelleEmail: rest.zelleEmail ?? null,
      paypalEmail: rest.paypalEmail ?? null,
    },
    update: {
      method: rest.method,
      bankName: rest.bankName ?? null,
      accountType: rest.accountType ?? null,
      routingNumberLast4: routingNumberLast4 ?? null,
      accountNumberLast4: accountNumberLast4 ?? null,
      zelleEmail: rest.zelleEmail ?? null,
      paypalEmail: rest.paypalEmail ?? null,
    },
  });

  return successResponse({
    method: record.method,
    routingNumberLast4: record.routingNumberLast4,
    accountNumberLast4: record.accountNumberLast4,
  });
}
