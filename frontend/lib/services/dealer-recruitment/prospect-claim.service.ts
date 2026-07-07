import 'server-only';
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// F-010 — convert a recruited DealerProspect into a DealerApplication via a
// tokenized one-click link in the outreach email, closing the manual midpoint
// where a responding prospect previously had to re-enter every field on the
// public application form. This intentionally creates a PENDING application
// (NOT an active dealer account) — approval still gates account creation — but
// the application is pre-filled from prospect data and flagged as originating
// from a Maps-discovered prospect, which F-011 treats as auto-approvable.

const CLAIM_TTL_DAYS = 30;

export function buildClaimUrl(rawToken: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
  return `${appUrl}/dealer/claim-prospect?token=${rawToken}`;
}

// Mint (or reuse) a claim token for a prospect. Reuses an existing, unexpired,
// unconverted token so re-sends share one link. No-op return for converted
// prospects.
export async function issueProspectClaimToken(prospectId: string): Promise<string | null> {
  const p = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: { id: true, claimToken: true, claimTokenExpiresAt: true, convertedApplicationId: true },
  });
  if (!p || p.convertedApplicationId) return null;

  const now = Date.now();
  if (p.claimToken && p.claimTokenExpiresAt && p.claimTokenExpiresAt.getTime() > now) {
    return p.claimToken;
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await prisma.dealerProspect.update({
    where: { id: prospectId },
    data: {
      claimToken: rawToken,
      claimTokenExpiresAt: new Date(now + CLAIM_TTL_DAYS * 86_400_000),
    },
  });
  return rawToken;
}

export interface ProspectPrefill {
  prospectId: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  contactName: string | null;
  contactEmail: string | null;
  alreadyConverted: boolean;
}

// Resolve a claim token to its prospect's prefill data (for the claim form).
export async function getProspectByClaimToken(token: string): Promise<ProspectPrefill | null> {
  if (!token) return null;
  const p = await prisma.dealerProspect.findUnique({ where: { claimToken: token } });
  if (!p) return null;
  if (p.claimTokenExpiresAt && p.claimTokenExpiresAt.getTime() < Date.now()) return null;
  return {
    prospectId: p.id,
    dealershipName: p.name,
    city: p.city,
    state: p.state,
    zip: p.zip,
    contactName: p.contactName ?? null,
    contactEmail: p.email,
    alreadyConverted: !!p.convertedApplicationId,
  };
}

export type ClaimResult =
  | { ok: true; applicationId: string; alreadyConverted: boolean }
  | { ok: false; error: string };

// Convert a prospect to a PENDING DealerApplication. Idempotent: a prospect
// already converted returns its existing application. The dealer supplies the
// one field prospects never carry — their license number.
export async function claimProspectToApplication(
  token: string,
  input: { licenseNumber: string; contactName?: string; contactEmail?: string },
): Promise<ClaimResult> {
  const license = (input.licenseNumber ?? "").trim();
  if (!license) return { ok: false, error: "License number is required." };

  const p = await prisma.dealerProspect.findUnique({ where: { claimToken: token } });
  if (!p) return { ok: false, error: "Invalid or expired claim link." };
  if (p.claimTokenExpiresAt && p.claimTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This claim link has expired." };
  }
  if (p.convertedApplicationId) {
    return { ok: true, applicationId: p.convertedApplicationId, alreadyConverted: true };
  }

  const contactEmail = (input.contactEmail ?? p.email ?? "").toLowerCase().trim();
  const contactName = (input.contactName ?? p.contactName ?? p.name).trim();
  if (!contactEmail) return { ok: false, error: "A contact email is required." };

  // Reuse an existing in-flight application for this email rather than duplicate.
  const existing = await prisma.dealerApplication.findFirst({
    where: { contactEmail, status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true },
  });

  const application =
    existing ??
    (await prisma.dealerApplication.create({
      data: {
        dealershipName: p.name,
        dealershipType: "Independent",
        state: p.state ?? "",
        city: p.city ?? "",
        zip: p.zip ?? "",
        licenseNumber: license,
        contactName,
        contactEmail,
        contactPhone: p.contactPhone ?? p.phone ?? null,
        // Provenance: record the prospect's real origin. Do NOT assert a
        // "verified placeId" — the DealerProspect model carries no place-id
        // field, so that claim was always fabricated and could mislead any
        // auto-approval that reads this note. State honestly what we know and
        // that license/identity still require manual review.
        notes: `[Origin: recruited prospect ${p.id} via ${
          p.buyerOppId ? "buyer-intake" : "bulk/Maps discovery"
        }${p.sourceUrl ? `; source ${p.sourceUrl}` : ""}. Dealer license & identity NOT independently verified — manual review required.]`,
        status: "PENDING",
      },
      select: { id: true },
    }));

  await prisma.dealerProspect.update({
    where: { id: p.id },
    data: {
      status: "ONBOARDED",
      onboardedAt: new Date(),
      convertedApplicationId: application.id,
      replyDetectedAt: p.replyDetectedAt ?? new Date(),
    },
  });

  return { ok: true, applicationId: application.id, alreadyConverted: false };
}
