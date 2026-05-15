// POST /api/admin/buyers/[buyerId]/preview-token
// Generates a short-lived signed token allowing admin to view a buyer's page.
// Token is appended to the buyer route URL as ?preview_token=xxx
// Expires in 5 minutes. Stateless JWT — no DB storage needed.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  stageRoute: z.string().startsWith("/buyer/", {
    message: "stageRoute must be a buyer route starting with /buyer/",
  }),
});

function getSecret() {
  const raw =
    process.env.JWT_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.APP_SECRET;
  if (!raw) throw new Error("No JWT secret configured for preview tokens");
  return new TextEncoder().encode(raw);
}

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { buyerId } = await params;

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  const { stageRoute } = parsed.data;

  const token = await new SignJWT({
    buyerId,
    adminId: admin.adminId,
    adminEmail: admin.email,
    stageRoute,
    buyerName: `${buyer.firstName ?? ""} ${buyer.lastName ?? ""}`.trim(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getSecret());

  return adminSuccess({ token, expiresIn: 300 });
}
