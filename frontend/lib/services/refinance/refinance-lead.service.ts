// lib/services/refinance/refinance-lead.service.ts
//
// AutoLenis is a LEAD PROVIDER ONLY.
// This service screens refinance inquiries for basic fit and hands qualified leads
// off to OpenRoad Lending. AutoLenis NEVER makes credit decisions, never displays
// rates/APR/approval likelihood, never embeds the partner application, and never
// exposes an "approve/reject" action to admins.

import { logger } from "@/lib/logger";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { RefinanceStatus, type RefinanceApplication } from "@prisma/client";

// Exact partner URL template — do not modify the querystring shape
// (kept verbatim per product spec).
export const PARTNER_ID = "OPENROAD_LENDING";
export const PARTNER_NAME = "OpenRoad Lending";
// Partner agreement specifies the application URL must be of the form:
//   https://www.openroadlending.com/applyone/?aid=1445&opt_1=<leadId>
// `aid=1445` is AutoLenis's affiliate id and `opt_1` is the per-lead subid.
export const PARTNER_REDIRECT_BASE = "https://www.openroadlending.com/applyone/";
export const PARTNER_AFFILIATE_ID = "1445";

// Non-lending states per Exhibit B of the partner agreement.
export const EXCLUDED_STATES = ["AK", "HI", "MT", "NV", "NH", "ND", "WI"] as const;
export type ExcludedState = (typeof EXCLUDED_STATES)[number];

// Server-side qualification criteria. NOT disclosed to the user.
export const MIN_VEHICLE_YEAR = 2012;
export const MIN_LOAN_BALANCE_CENTS = 500_000; // $5,000

export interface RefinanceLeadInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  vehicleYear: number;
  loanBalanceCents: number;
  monthlyPaymentCents: number;
  interestRateBand: string;
  employmentStatus: string;
  state: string;
  consentGiven: boolean;
  ipAddress?: string | null;
  source?: string | null;
}

export interface RefinanceLeadResult {
  leadId: string;
  qualified: boolean;
  status: RefinanceStatus;
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex");
}

export function isExcludedState(state: string): boolean {
  return (EXCLUDED_STATES as readonly string[]).includes(state.toUpperCase());
}

function qualify(input: RefinanceLeadInput): { qualified: boolean; status: RefinanceStatus } {
  if (isExcludedState(input.state)) {
    return { qualified: false, status: RefinanceStatus.EXCLUDED_STATE };
  }
  if (input.vehicleYear < MIN_VEHICLE_YEAR) {
    return { qualified: false, status: RefinanceStatus.INELIGIBLE };
  }
  if (input.loanBalanceCents <= MIN_LOAN_BALANCE_CENTS) {
    return { qualified: false, status: RefinanceStatus.INELIGIBLE };
  }
  return { qualified: true, status: RefinanceStatus.QUALIFIED };
}

export async function submitRefinanceLead(input: RefinanceLeadInput): Promise<RefinanceLeadResult> {
  if (!input.consentGiven) {
    throw new Error("Consent is required before submission");
  }

  const { qualified, status } = qualify(input);
  const consentTimestamp = new Date();
  const ipHash = hashIp(input.ipAddress ?? null);

  const lead = await prisma.refinanceApplication.create({
    data: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.toLowerCase().trim(),
      phone: input.phone.trim(),
      vehicleYear: input.vehicleYear,
      loanBalanceCents: input.loanBalanceCents,
      monthlyPaymentCents: input.monthlyPaymentCents,
      interestRateBand: input.interestRateBand,
      employmentStatus: input.employmentStatus,
      state: input.state.toUpperCase(),
      consentGiven: input.consentGiven,
      consentTimestamp,
      ipHash,
      source: input.source ?? null,
      status,
    },
  });

  // Always write an audit log — every submission is auditable whether qualified or not.
  await prisma.refinanceComplianceLog.create({
    data: {
      applicationId: lead.id,
      tcpaConsent: input.consentGiven,
      consentTimestamp,
      ipAddress: input.ipAddress ?? null,
      source: input.source ?? "refinance_eligibility_form",
    },
  });

  // Emit the refinance_inquiry domain event AFTER all FCRA/compliance writes —
  // additive only, never touching the lending logic above. Best-effort:
  // a failure here must never block or alter the lead submission outcome.
  try {
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("refinance_inquiry", {
      domainEntityId: lead.id,
      contact: {
        email: input.email.toLowerCase().trim(),
        phone: input.phone.trim(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        source: "public_form",
        consentSms: input.consentGiven,
        consentEmail: input.consentGiven,
        consentText: "AutoLenis refinance eligibility form (TCPA consent)",
      },
      data: { lead_id: lead.id, qualified, status, state: input.state.toUpperCase() },
    });
  } catch (err) {
    logger.error("[refinance-lead] emit failed:", err);
  }

  return { leadId: lead.leadId, qualified, status };
}

export async function markLeadRedirected(leadId: string): Promise<RefinanceApplication | null> {
  const lead = await prisma.refinanceApplication.findUnique({ where: { leadId } });
  if (!lead) return null;
  // Only QUALIFIED leads may transition to REDIRECTED.
  if (lead.status !== RefinanceStatus.QUALIFIED && lead.status !== RefinanceStatus.REDIRECTED) {
    return lead;
  }
  return prisma.refinanceApplication.update({
    where: { leadId },
    data: {
      status: RefinanceStatus.REDIRECTED,
      redirectedAt: new Date(),
    },
  });
}

export function buildPartnerRedirectUrl(leadId: string): string {
  // opt_1 is the per-lead subid OpenRoad uses to attribute the referral back to
  // a real AutoLenis lead. It must never be empty or a placeholder — an unattributed
  // handoff breaks reconciliation under the partner agreement — so we hard-fail
  // rather than emit `opt_1=`.
  if (!leadId || !leadId.trim()) {
    throw new Error("buildPartnerRedirectUrl requires a non-empty leadId");
  }
  // Only include parameters that have real values. OpenRoad's server parses
  // these as typed values, so passing the literal string "null" (or any other
  // empty placeholder) for missing optional fields causes a server-side
  // FormatException. Stick to `aid` and `opt_1` unless additional fields are
  // added here with verified, non-empty values from the lead record.
  const params = new URLSearchParams();
  params.set("aid", PARTNER_AFFILIATE_ID);
  params.set("opt_1", leadId.trim());
  return `${PARTNER_REDIRECT_BASE}?${params.toString()}`;
}

export async function getLeadByLeadId(leadId: string) {
  return prisma.refinanceApplication.findUnique({
    where: { leadId },
    include: {
      complianceLogs: { orderBy: { consentTimestamp: "desc" } },
    },
  });
}
