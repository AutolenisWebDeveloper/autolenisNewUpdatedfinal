// GET    /api/admin/dealer-outreach/[prospectId] — single prospect + buyer opp.
// PATCH  /api/admin/dealer-outreach/[prospectId] — edit script/notes/status.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { DealerProspectStatus, type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ prospectId: string }>;
}

const VALID_STATUSES = new Set<string>(Object.values(DealerProspectStatus));

export async function GET(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { prospectId } = await params;

  try {
    const prospect = await prisma.dealerProspect.findUnique({
      where: { id: prospectId },
      include: {
        buyerOpp: true,
        // Full communication history, newest first (powers the detail timeline).
        outreachLog: { orderBy: { sentAt: "desc" } },
      },
    });
    if (!prospect) return adminError("NOT_FOUND", "Prospect not found", 404);
    return adminSuccess({ prospect });
  } catch (err) {
    return adminError(
      "FETCH_FAILED",
      err instanceof Error ? err.message : "Failed to fetch prospect",
      500,
    );
  }
}

interface PatchBody {
  outreachScript?: string;
  founderNotes?: string;
  status?: string;
  deadReason?: string;
  // Phase 4B-1 — manual email override. Pass empty string to clear.
  email?: string;
  // Inline-editable profile fields (enhanced dealer management page).
  website?: string;
  contactName?: string;
  contactTitle?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

// String fields that admins may edit inline from the detail page. Each accepts a
// trimmed value, or an empty string to clear (stored as null).
const EDITABLE_TEXT_FIELDS = [
  "website",
  "contactName",
  "contactTitle",
  "city",
  "state",
  "zip",
  "phone",
] as const;

// Same permissive check the enrichment service uses before persisting.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { prospectId } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  const existing = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { id: true },
  });
  if (!existing) return adminError("NOT_FOUND", "Prospect not found", 404);

  const data: Prisma.DealerProspectUpdateInput = {};

  if (typeof body.outreachScript === "string") {
    data.outreachScript = body.outreachScript;
  }
  if (typeof body.founderNotes === "string") {
    data.founderNotes = body.founderNotes;
  }
  if (typeof body.deadReason === "string") {
    data.deadReason = body.deadReason;
  }

  // Inline profile edits — only the explicitly allow-listed fields are accepted.
  for (const field of EDITABLE_TEXT_FIELDS) {
    const value = body[field];
    if (typeof value === "string") {
      const trimmed = value.trim();
      data[field] = trimmed === "" ? null : trimmed;
    }
  }

  // Manual email override — founder-entered address takes precedence over any
  // Gemini-sourced value and is tagged emailSource="manual".
  if (typeof body.email === "string") {
    const trimmed = body.email.trim();
    if (trimmed === "") {
      // Explicit clear.
      data.email = null;
      data.emailSource = null;
      data.emailEnrichedAt = new Date();
    } else if (EMAIL_REGEX.test(trimmed)) {
      data.email = trimmed.toLowerCase();
      data.emailSource = "manual";
      data.emailEnrichedAt = new Date();
    } else {
      return adminError("INVALID_EMAIL", `Invalid email: ${trimmed}`, 422);
    }
  }

  if (body.status) {
    if (!VALID_STATUSES.has(body.status)) {
      return adminError("INVALID_STATUS", `Unknown status: ${body.status}`, 422);
    }
    const status = body.status as DealerProspectStatus;
    data.status = status;
    const now = new Date();
    // Stamp the timestamp that matches the new status.
    switch (status) {
      case "SCRIPTED":
        data.scriptedAt = now;
        break;
      case "CONTACTED":
        data.contactedAt = now;
        break;
      case "REPLIED":
        data.repliedAt = now;
        break;
      case "ONBOARDED":
        data.onboardedAt = now;
        break;
      case "DEAD":
        data.deadAt = now;
        break;
    }
  }

  try {
    const prospect = await prisma.dealerProspect.update({
      where: { id: prospectId },
      data,
      include: { buyerOpp: true },
    });
    return adminSuccess({ prospect });
  } catch (err) {
    return adminError(
      "UPDATE_FAILED",
      err instanceof Error ? err.message : "Failed to update prospect",
      500,
    );
  }
}
