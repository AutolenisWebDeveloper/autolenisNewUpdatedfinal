// lib/services/email/resend.service.ts
// Transactional email via Resend — ONLY approved email provider
// All sends are idempotent — check EmailSendLog before every send
// FROM_NAME and RESEND_API_KEY from env

import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_CENTS, PREMIUM_FEE_USD, COMMISSION_RATES, formatCentsAsUsd } from "@/lib/constants";

// L1 affiliate commission on the Premium concierge fee.
// Derived from constants so a fee or rate change is reflected automatically.
const L1_PREMIUM_FEE_COMMISSION_USD = formatCentsAsUsd(
  Math.round(PREMIUM_FEE_CENTS * COMMISSION_RATES.LEVEL_1),
);
const L1_PCT_LABEL = `${Math.round(COMMISSION_RATES.LEVEL_1 * 100)}%`;
const L2_PCT_LABEL = `${Math.round(COMMISSION_RATES.LEVEL_2 * 100)}%`;
const L3_PCT_LABEL = `${Math.round(COMMISSION_RATES.LEVEL_3 * 100)}%`;
import { prequalApprovedHtml } from "./templates/prequal-approved";
import {
  ADVERSE_ACTION_SUBJECT,
  renderAdverseActionEmail,
} from "./templates/adverse-action";
import {
  PREQUAL_UNDER_REVIEW_SUBJECT,
  renderPrequalUnderReviewEmail,
} from "./templates/prequal-under-review";
import {
  ADMIN_PREQUAL_ALERT_SUBJECT_REVIEW,
  ADMIN_PREQUAL_ALERT_SUBJECT_PROVIDER,
  renderAdminPrequalAlertEmail,
  type AdminPrequalAlertKind,
} from "./templates/admin-prequal-alert";
import { WELCOME_EMAIL_SUBJECT, renderWelcomeEmail } from "./templates/welcome";
import {
  LEAD_MAGNET_DELIVERY_SUBJECT,
  renderLeadMagnetDeliveryEmail,
} from "./templates/lead-magnet-delivery";
import { EMAIL_VERIFIED_SUBJECT, renderEmailVerifiedEmail } from "./templates/email-verified";
import {
  DEPOSIT_CONFIRMATION_SUBJECT,
  renderDepositConfirmationEmail,
} from "./templates/deposit-confirmation";
import { AUCTION_ACTIVATED_SUBJECT, renderAuctionActivatedEmail } from "./templates/auction-activated";
import { OFFERS_READY_SUBJECT, renderOffersReadyEmail } from "./templates/offers-ready";
import { DEAL_SELECTED_SUBJECT, renderDealSelectedEmail } from "./templates/deal-selected";
import { DEAL_COMPLETE_SUBJECT, renderDealCompleteEmail } from "./templates/deal-complete";
import { PASSWORD_RESET_SUBJECT, renderPasswordResetEmail } from "./templates/password-reset";
import {
  CONTRACT_SHIELD_ALERT_SUBJECT,
  renderContractShieldAlertEmail,
} from "./templates/contract-shield-alert";
import { CONTRACT_APPROVED_SUBJECT, renderContractApprovedEmail } from "./templates/contract-approved";
import { DEALER_APPLICATION_RECEIVED_SUBJECT, renderDealerApplicationReceivedEmail } from "./templates/dealer-application-received";
import { DEALER_APPLICATION_APPROVED_SUBJECT, renderDealerApplicationApprovedEmail } from "./templates/dealer-application-approved";
import { DEALER_APPLICATION_REJECTED_SUBJECT, renderDealerApplicationRejectedEmail } from "./templates/dealer-application-rejected";
import { DEALER_INVITATION_SUBJECT, renderDealerInvitationEmail } from "./templates/dealer-invitation";
import { DEALER_WELCOME_SUBJECT, renderDealerWelcomeEmail } from "./templates/dealer-welcome";
import { DEALER_AGREEMENT_PENDING_SUBJECT, renderDealerAgreementPendingEmail } from "./templates/dealer-agreement-pending";
import { DEALER_ACCOUNT_APPROVED_SUBJECT, renderDealerAccountApprovedEmail } from "./templates/dealer-account-approved";
import { DEALER_ACCOUNT_REINSTATED_SUBJECT, renderDealerAccountReinstatedEmail } from "./templates/dealer-account-reinstated";
import { DEALER_ACCOUNT_SUSPENDED_SUBJECT, renderDealerAccountSuspendedEmail } from "./templates/dealer-account-suspended";
import { DEALER_ACCOUNT_TERMINATED_SUBJECT, renderDealerAccountTerminatedEmail } from "./templates/dealer-account-terminated";
import { DEALER_AUCTION_INVITATION_SUBJECT, renderDealerAuctionInvitationEmail } from "./templates/dealer-auction-invitation";
import { DEALER_AUCTION_REMINDER_SUBJECT, renderDealerAuctionReminderEmail } from "./templates/dealer-auction-reminder";
import { DEALER_OFFER_SUBMITTED_SUBJECT, renderDealerOfferSubmittedEmail } from "./templates/dealer-offer-submitted";
import { DEALER_OFFER_REVISION_CLOSING_SUBJECT, renderDealerOfferRevisionClosingEmail } from "./templates/dealer-offer-revision-closing";
import { DEALER_OFFER_WON_SUBJECT, renderDealerOfferWonEmail } from "./templates/dealer-offer-won";
import { DEALER_OFFER_LOST_SUBJECT, renderDealerOfferLostEmail } from "./templates/dealer-offer-lost";
import { DEALER_AUCTION_CLOSED_NO_WINNER_SUBJECT, renderDealerAuctionClosedNoWinnerEmail } from "./templates/dealer-auction-closed-no-winner";
import { DEALER_CONTRACT_PENDING_SUBJECT, renderDealerContractPendingEmail } from "./templates/dealer-contract-pending";
import { DEALER_CONTRACT_ISSUES_SUBJECT, renderDealerContractIssuesEmail } from "./templates/dealer-contract-issues";
import { DEALER_ESIGN_INITIATED_SUBJECT, renderDealerEsignInitiatedEmail } from "./templates/dealer-esign-initiated";
import { DEALER_PICKUP_SCHEDULED_SUBJECT, renderDealerPickupScheduledEmail } from "./templates/dealer-pickup-scheduled";
import { DEALER_PICKUP_COMPLETED_SUBJECT, renderDealerPickupCompletedEmail } from "./templates/dealer-pickup-completed";
import { DEALER_PAYOUT_INITIATED_SUBJECT, renderDealerPayoutInitiatedEmail } from "./templates/dealer-payout-initiated";
import { DEALER_WEEKLY_SCORECARD_SUBJECT, renderDealerWeeklyScorecardEmail } from "./templates/dealer-weekly-scorecard";
import { DEALER_INVENTORY_SYNC_FAILURE_SUBJECT, renderDealerInventorySyncFailureEmail } from "./templates/dealer-inventory-sync-failure";
import { DEALER_STALE_LISTING_REMOVAL_SUBJECT, renderDealerStaleListingRemovalEmail } from "./templates/dealer-stale-listing-removal";
import { DEALER_COMPLIANCE_NOTICE_SUBJECT, renderDealerComplianceNoticeEmail } from "./templates/dealer-compliance-notice";
import { DEALER_PASSWORD_RESET_SUBJECT, renderDealerPasswordResetEmail } from "./templates/dealer-password-reset";
import { DEALER_NEW_BUYER_OPPORTUNITY_SUBJECT, renderDealerNewBuyerOpportunityEmail } from "./templates/dealer-new-buyer-opportunity";
import {
  DEPOSIT_PAYMENT_LINK_SUBJECT,
  CONCIERGE_FEE_PAYMENT_LINK_SUBJECT,
  renderDepositPaymentLinkEmail,
  renderConciergeFeePaymentLinkEmail,
} from "./templates/admin-payment-link";
import {
  BUYER_OPPORTUNITY_CONFIRMATION_SUBJECT,
  renderBuyerOpportunityConfirmationEmail,
} from "./templates/buyer-opportunity-confirmation";
import {
  FOUNDER_HOT_LEAD_ALERT_SUBJECT,
  renderFounderHotLeadAlertEmail,
} from "./templates/founder-hot-lead-alert";

// Lazy Resend client — constructed on first use. Keeping this lazy prevents
// Next.js build-time page data collection from throwing when the API key
// isn't in scope (e.g. during `next build` without RESEND_API_KEY).
let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}
const FROM_NAME = process.env.FROM_NAME ?? "AutoLenis";
const FROM_EMAIL = "noreply@autolenis.com";
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// Discriminated outcome of a send attempt. `sent` is retained for backward
// compatibility with existing boolean callers; new logic should branch on
// `outcome` so DUPLICATE / FAILED / DEV_SKIPPED can be told apart — they all
// share `sent === false` but require very different audit handling.
export type EmailSendOutcome =
  | { sent: true;  outcome: "SENT";        resendId?: string }
  | { sent: false; outcome: "DUPLICATE";   resendId?: string }
  | { sent: false; outcome: "FAILED" }
  | { sent: false; outcome: "DEV_SKIPPED" };

// Idempotent send — check EmailSendLog before sending
async function sendIdempotent(params: {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  templateId: string;
}): Promise<EmailSendOutcome> {
  // Check idempotency — never send duplicate emails. If the lookup fails
  // (e.g. transient DB connectivity issue), log and proceed with the send
  // rather than silently skipping it.
  let existing: Awaited<ReturnType<typeof prisma.emailSendLog.findUnique>> | null = null;
  try {
    existing = await prisma.emailSendLog.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
  } catch (err) {
    logger.error("[EMAIL] EmailSendLog check failed — proceeding with send:", err);
    // Non-blocking — allow send to proceed even if idempotency check fails
  }
  if (existing) {
    return { sent: false, outcome: "DUPLICATE", resendId: existing.resendId ?? undefined };
  }

  let resendId: string | undefined;
  let status: "SENT" | "FAILED" | "DEV_SKIPPED" = "SENT";

  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey.includes("placeholder")) {
      // Dev: log email intent but don't send
      logger.warn(
        `[EMAIL] RESEND_API_KEY not set or is placeholder — email skipped. To: ${params.to}`,
      );
      status = "DEV_SKIPPED";
    } else {
      const resend = getResend();
      if (!resend) {
        logger.error("[EMAIL] Resend client could not be initialized despite API key being set");
        status = "DEV_SKIPPED";
      } else {
        const result = await resend.emails.send({
          from: FROM,
          to: params.to,
          subject: params.subject,
          html: params.html,
        });
        // The Resend SDK swallows network/HTTP errors internally and surfaces
        // them via `result.error` rather than throwing. Treat any non-success
        // response as FAILED so the audit trail records a real outage instead
        // of silently logging as SENT with no resendId.
        if (result.error || !result.data?.id) {
          logger.error(
            `[EMAIL] Resend dispatch failed for ${params.to}:`,
            result.error ?? "no id returned",
          );
          status = "FAILED";
        } else {
          resendId = result.data.id;
        }
      }
    }
  } catch (err) {
    logger.error(`Email send failed: ${err}`);
    status = "FAILED";
  }

  // Log the send attempt
  await prisma.emailSendLog.create({
    data: {
      idempotencyKey: params.idempotencyKey,
      recipient: params.to,
      templateId: params.templateId,
      status,
      resendId: resendId ?? null,
    },
  });

  if (status === "SENT")        return { sent: true,  outcome: "SENT", resendId };
  if (status === "FAILED")      return { sent: false, outcome: "FAILED" };
  /* DEV_SKIPPED */              return { sent: false, outcome: "DEV_SKIPPED" };
}

// ─── CRM Dispatch Wrapper ─────────────────────────────────────────────────────
// Outcome-verified entrypoint for the Make.com inbound dispatch endpoint
// (/api/crm/dispatch/email). It does NOT rewrite the send core — it delegates
// to the same idempotent rail as every other template, exposing the existing
// EmailSendOutcome discriminated union so the dispatch route can tell SENT from
// DUPLICATE / FAILED / DEV_SKIPPED and never record a swallowed success as
// delivered. Consent + suppression gating happen in the route BEFORE this call.
export async function sendCrmDispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  // Stable template handle for audit/log attribution (e.g. a Make scenario's
  // templateKey). Falls back to a generic dispatch label.
  templateKey?: string;
}): Promise<EmailSendOutcome> {
  return sendIdempotent({
    idempotencyKey: params.idempotencyKey,
    to: params.to,
    subject: params.subject,
    html: params.html,
    templateId: params.templateKey ?? "crm-dispatch",
  });
}

// ─── Email Templates ────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  to: string;
  firstName: string;
  verificationUrl: string;
  idempotencyKey?: string;
}) {
  const { to, firstName, verificationUrl, idempotencyKey } = params;
  return sendIdempotent({
    idempotencyKey: idempotencyKey ?? `welcome-${to}`,
    to,
    templateId: "welcome",
    subject: WELCOME_EMAIL_SUBJECT(firstName),
    html: renderWelcomeEmail({ firstName, verificationUrl }),
  });
}

// Phase C-Tools — welcome email for buyers who request a negotiation strategy
// from the public Dealer Fee Calculator. Idempotency-keyed on the lead's
// opportunity session id so a double form submit never double-sends.
export async function sendDealerFeeCalculatorWelcomeEmail(params: {
  to: string;
  firstName: string;
  state: string;
  segmentLabel: string;
  sessionId: string;
}) {
  const { to, firstName, state, segmentLabel, sessionId } = params;
  const calculatorUrl = `${APP_URL}/tools/dealer-fee-calculator`;
  const buyersUrl = `${APP_URL}/request-a-car`;
  return sendIdempotent({
    idempotencyKey: `dealer-fee-lead-${sessionId}`,
    to,
    templateId: "dealer-fee-calculator-welcome",
    subject: "Your car dealer fee negotiation strategy — AutoLenis",
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Don't Overpay on Dealer Fees</h1>
        </div>
        <div style="padding:32px;color:#1f2937;line-height:1.7;font-size:14px">
          <p>Hi ${firstName},</p>
          <p>Thanks for using the AutoLenis Dealer Fee Calculator. Here's the single most important thing to remember when you sit down at the dealership in ${state}:</p>
          <p style="background:#F8F9FB;border-left:3px solid #0B5FD1;padding:12px 16px;margin:16px 0"><strong>Make them itemize every fee in writing before you agree to anything.</strong> Required state fees (title, registration) are fixed. Everything else — doc fees, add-ons, "market adjustments" — is negotiable or pure markup.</p>
          <p>Three lines that work:</p>
          <ul style="padding-left:20px;color:#4B5563">
            <li>"Please remove the add-ons — I only want the vehicle."</li>
            <li>"What's your out-the-door price, all fees included?"</li>
            <li>"I'm comparing this against other dealers' total price."</li>
          </ul>
          <p>The fastest way to skip the fee games entirely: let dealers compete for your business privately. With AutoLenis, up to 8 local dealers submit their best out-the-door price in a 48-hour auction — you pick the winner.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${buyersUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Get Dealers to Compete →</a>
          </div>
          <p style="color:#4B5563;font-size:13px">Want to re-check a fee? <a href="${calculatorUrl}" style="color:#0B5FD1">Open the calculator again</a>.</p>
          <p style="margin-top:24px;color:#94A3B8;font-size:12px">You're receiving this because you requested a negotiation strategy from the AutoLenis Dealer Fee Calculator (${segmentLabel}).</p>
        </div>
      </div>
    `,
  });
}

// Phase C-Leads — delivers a free lead-magnet guide to a buyer. Idempotency is
// keyed on the lead's opportunity session id so a double form submit never
// double-sends the guide. The segment intro tailors the opener by timeline.
export async function sendLeadMagnetDeliveryEmail(params: {
  to: string;
  firstName: string;
  magnetTitle: string;
  magnetDescription: string;
  bullets: string[];
  accessPath: string; // e.g. /guide/thank-you?m=honest-guide
  segmentIntro: string;
  sessionId: string;
}) {
  const {
    to,
    firstName,
    magnetTitle,
    magnetDescription,
    bullets,
    accessPath,
    segmentIntro,
    sessionId,
  } = params;
  const accessUrl = `${APP_URL}${accessPath}`;
  const auctionUrl = `${APP_URL}/request-a-car`;
  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(to)}`;
  return sendIdempotent({
    idempotencyKey: `lead-magnet-delivery-${sessionId}`,
    to,
    templateId: "lead-magnet-delivery",
    subject: LEAD_MAGNET_DELIVERY_SUBJECT(magnetTitle),
    html: renderLeadMagnetDeliveryEmail({
      firstName,
      magnetTitle,
      magnetDescription,
      bullets,
      accessUrl,
      auctionUrl,
      unsubscribeUrl,
      segmentIntro,
    }),
  });
}

export async function sendBuyerOpportunityConfirmationEmail(params: {
  to: string;
  firstName: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
  sessionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `buyer-opp-confirmation-${params.sessionId}`,
    to: params.to,
    templateId: "buyer-opportunity-confirmation",
    subject: BUYER_OPPORTUNITY_CONFIRMATION_SUBJECT(params.vehicle),
    html: renderBuyerOpportunityConfirmationEmail({
      firstName: params.firstName,
      vehicle: params.vehicle,
      budget: params.budget,
      timeline: params.timeline,
      zip: params.zip,
    }),
  });
}

export async function sendFounderHotLeadAlertEmail(params: {
  to: string;
  firstName: string;
  email: string;
  phone: string;
  vehicle: string;
  budget: string;
  timeline: string;
  zip: string;
  score: number;
  scoringReason: string;
  sessionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `founder-hot-lead-${params.sessionId}`,
    to: params.to,
    templateId: "founder-hot-lead-alert",
    subject: FOUNDER_HOT_LEAD_ALERT_SUBJECT(params.firstName, params.vehicle),
    html: renderFounderHotLeadAlertEmail({
      firstName: params.firstName,
      email: params.email,
      phone: params.phone,
      vehicle: params.vehicle,
      budget: params.budget,
      timeline: params.timeline,
      zip: params.zip,
      score: params.score,
      scoringReason: params.scoringReason,
      sessionId: params.sessionId,
    }),
  });
}

export async function sendAuctionActivatedEmail(to: string, buyerName: string, auctionId: string) {
  const auctionUrl = `${APP_URL}/buyer/auctions`;
  return sendIdempotent({
    idempotencyKey: `auction-activated-${auctionId}`,
    to,
    templateId: "auction-activated",
    subject: AUCTION_ACTIVATED_SUBJECT,
    html: renderAuctionActivatedEmail({ firstName: buyerName, auctionUrl }),
  });
}

export async function sendOffersReadyEmail(to: string, buyerName: string, auctionId: string, offerCount: number) {
  void offerCount; // offer count not shown in email (buyers view in app)
  const offersUrl = `${APP_URL}/buyer/auctions/${auctionId}/offers`;
  return sendIdempotent({
    idempotencyKey: `offers-ready-${auctionId}`,
    to,
    templateId: "offers-ready",
    subject: OFFERS_READY_SUBJECT(buyerName),
    html: renderOffersReadyEmail({ firstName: buyerName, offersUrl }),
  });
}

export async function sendPrequalApprovedEmail(params: {
  to: string;
  firstName: string;
  maxOtdAmountCents: number;
  tier: string | null;
  decisionDate: Date;
  expiryDate: Date;
  /** Optional full override of the idempotency key — used by the admin
   *  resend endpoint so a second resend on the same day isn't silently
   *  collapsed by the day-granular default. Buyer-facing decision-time
   *  callers leave this unset. */
  idempotencyKey?: string;
}) {
  const { to, firstName, maxOtdAmountCents, tier, expiryDate } = params;
  return sendIdempotent({
    idempotencyKey:
      params.idempotencyKey ??
      `prequal-approved-${to}-${params.decisionDate.toISOString().slice(0, 10)}`,
    to,
    templateId: "prequal-approved",
    subject: `You're Pre-Qualified — Here's Your Buying Power, ${firstName}`,
    html: prequalApprovedHtml({ firstName, maxOtdAmountCents, tier, expiryDate }),
  });
}

// Buyer email for MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED states.
// OFAC-silent — the copy never mentions OFAC, sanctions, or the cause; the
// buyer only knows their application is being reviewed and to expect an
// update within 1–2 business days.
//
// Idempotency: keyed on prequalApplicationId + decisionTimestamp. The prequal
// row is upserted in place (buyerId is @unique) so the id alone is stable
// across a buyer's lifetime — re-entering MANUAL_REVIEW after a correction
// cycle would otherwise be silently de-duplicated and the buyer never
// re-notified. Pass the upserted row's `updatedAt.toISOString()` so each
// genuine decision yields a unique key while a true intra-request double-send
// still collapses.
export async function sendPrequalUnderReviewEmail(params: {
  to: string;
  firstName: string;
  prequalApplicationId: string;
  decisionTimestamp: string;
}) {
  return sendIdempotent({
    idempotencyKey: `prequal-under-review-${params.prequalApplicationId}-${params.decisionTimestamp}`,
    to: params.to,
    templateId: "prequal-under-review",
    subject: PREQUAL_UNDER_REVIEW_SUBJECT,
    html: renderPrequalUnderReviewEmail({ firstName: params.firstName }),
  });
}

// Admin ops alert. Routed to ADMIN_NOTIFICATION_EMAIL — never hardcoded.
// Returns { sent: false } silently when the env var is not configured so the
// rest of the prequal flow is never blocked on ops email availability.
export async function sendAdminPrequalAlertEmail(params: {
  kind: AdminPrequalAlertKind;
  buyerId: string;
  buyerEmail: string;
  decision: string;
  providerReason?: string | null;
  prequalApplicationId: string;
}) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    logger.warn(
      "[EMAIL] ADMIN_NOTIFICATION_EMAIL not set — admin prequal alert skipped",
    );
    return { sent: false };
  }
  return sendIdempotent({
    idempotencyKey: `admin-prequal-${params.kind.toLowerCase()}-${params.prequalApplicationId}`,
    to,
    templateId: "admin-prequal-alert",
    subject:
      params.kind === "REVIEW"
        ? ADMIN_PREQUAL_ALERT_SUBJECT_REVIEW
        : ADMIN_PREQUAL_ALERT_SUBJECT_PROVIDER,
    html: renderAdminPrequalAlertEmail({
      kind: params.kind,
      buyerId: params.buyerId,
      buyerEmail: params.buyerEmail,
      decision: params.decision,
      providerReason: params.providerReason ?? null,
      appUrl: APP_URL,
    }),
  });
}

// AutoLenis Market Index — admin notification that the weekly LinkedIn
// newsletter was published. Routed to ADMIN_NOTIFICATION_EMAIL; silently skips
// when unset so the cron is never blocked on ops email availability.
export async function sendMarketIndexPublishedEmail(params: {
  weekOf: string;
  summary: string;
  linkedInUrl?: string;
}) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    logger.warn("[EMAIL] ADMIN_NOTIFICATION_EMAIL not set — market index alert skipped");
    return { sent: false as const };
  }
  const linkBlock = params.linkedInUrl
    ? `<p style="margin:16px 0"><a href="${params.linkedInUrl}" style="color:#0B5FD1;font-weight:700">View on LinkedIn →</a></p>`
    : "";
  return sendIdempotent({
    idempotencyKey: `market-index-${params.weekOf.replace(/\s+/g, "-").toLowerCase()}`,
    to,
    templateId: "market-index-published",
    subject: "AutoLenis Market Index Published",
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#0B5FD1;padding:28px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:20px">AutoLenis Market Index</h1>
          <p style="color:#cfe0ff;margin:6px 0 0;font-size:13px">Week of ${params.weekOf}</p>
        </div>
        <div style="padding:28px;color:#1f2937;line-height:1.7;font-size:14px">
          <p>${params.summary}</p>
          ${linkBlock}
        </div>
      </div>
    `,
  });
}

// Social Engine — weekly optimization report (Session D). Sent to the admin
// after the weekly social-optimize cron with the week's top performers, the
// posting-window changes the optimizer made, and next-week focus. Idempotency
// is keyed on the recipient + weekOf so a re-run of the cron never double-sends.
export async function sendOptimizationReport(input: {
  to: string;
  weekOf: string;
  topFranchise: string;
  topHook: string;
  topPlatform: string;
  topCity: string;
  totalLeads: number;
  totalRevenueCents: number;
  postingWindowChanges: string[];
  franchiseShifts: string[];
  nextWeekFocus: string;
}): Promise<void> {
  const subject = `AutoLenis Social Engine — Weekly Report (${input.weekOf})`;
  const dashboardUrl = "https://www.autolenis.com/admin/social";
  const revenue = `$${(input.totalRevenueCents / 100).toLocaleString("en-US")}`;

  const metricRow = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 0;color:#64748B;font-size:13px">${label}</td>
      <td style="padding:8px 0;color:#0F172A;font-size:13px;font-weight:700;text-align:right">${value}</td>
    </tr>`;

  const listBlock = (items: string[]) =>
    items.length > 0
      ? `<ul style="margin:8px 0 0;padding-left:20px;color:#4B5563;font-size:13px;line-height:1.7">${items
          .map((i) => `<li>${i}</li>`)
          .join("")}</ul>`
      : `<p style="margin:8px 0 0;color:#94A3B8;font-size:13px">No changes this week.</p>`;

  const weekKey = input.weekOf.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  await sendIdempotent({
    idempotencyKey: `social-optimization-report-${input.to}-${weekKey}`,
    to: input.to,
    templateId: "social-optimization-report",
    subject,
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#0B5FD1;padding:28px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:20px">Social Engine Weekly Report</h1>
          <p style="color:#cfe0ff;margin:6px 0 0;font-size:13px">Week of ${input.weekOf}</p>
        </div>
        <div style="padding:28px;color:#1f2937;line-height:1.6;font-size:14px">
          <h2 style="font-size:14px;color:#0F172A;margin:0 0 8px">Performance</h2>
          <table style="width:100%;border-collapse:collapse">
            ${metricRow("Top franchise", input.topFranchise)}
            ${metricRow("Top hook", input.topHook)}
            ${metricRow("Top platform", input.topPlatform)}
            ${metricRow("Top market", input.topCity)}
            ${metricRow("Leads this week", String(input.totalLeads))}
            ${metricRow("Revenue attributed", revenue)}
          </table>

          <h2 style="font-size:14px;color:#0F172A;margin:24px 0 4px">Changes</h2>
          ${listBlock([...input.postingWindowChanges, ...input.franchiseShifts])}

          <h2 style="font-size:14px;color:#0F172A;margin:24px 0 4px">Next Week Focus</h2>
          <p style="margin:8px 0 0;color:#4B5563;font-size:13px">${input.nextWeekFocus}</p>

          <div style="text-align:center;margin:28px 0 4px">
            <a href="${dashboardUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">View Full Dashboard &rarr;</a>
          </div>
        </div>
      </div>
    `,
  });
}

// Creator network — weekly content-package delivery. Sent to each active
// creator with the week's ready-to-share posts (links pre-built with their
// attribution). Idempotency-keyed on creator email + week so a re-run of the
// distribution cron in the same week never double-sends.
export async function sendCreatorPackageEmail(input: {
  to: string;
  name: string;
  weekOf: string;
  postsCount: number;
  emailBody: string;
}): Promise<void> {
  const weekKey = input.weekOf.replace(/,/g, "").replace(/\s+/g, "-").toLowerCase();
  const portalUrl = `${APP_URL}/affiliate/portal/dashboard`;
  const bodyHtml = input.emailBody
    .split("\n")
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px">${line}</p>` : ""))
    .join("");
  await sendIdempotent({
    idempotencyKey: `creator-package-${input.to}-${weekKey}`,
    to: input.to,
    templateId: "creator-package",
    subject: `Your AutoLenis content package — week of ${input.weekOf}`,
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#0B5FD1;padding:28px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:20px">Your Weekly Content Package</h1>
          <p style="color:#cfe0ff;margin:6px 0 0;font-size:13px">Week of ${input.weekOf} &middot; ${input.postsCount} post${input.postsCount !== 1 ? "s" : ""}</p>
        </div>
        <div style="padding:28px;color:#1f2937;line-height:1.7;font-size:14px">
          ${bodyHtml}
          <div style="text-align:center;margin:24px 0">
            <a href="${portalUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open your creator dashboard &rarr;</a>
          </div>
        </div>
      </div>
    `,
  });
}

// FCRA § 615 adverse action notice. Required by law to be sent to any
// consumer whose AutoLenis prequalification is DECLINED based in whole or
// in part on a consumer report (MicroBilt iPredict). See
// `templates/adverse-action.tsx` for the legally required content.
//
// Idempotency: the prequal row is upserted in place (buyerId is @unique) so
// the prequal id alone is stable across a buyer's lifetime. Now that a
// DECLINED prequal is non-valid (D-B) and re-submittable, a second genuine
// decline MUST send its own § 615 notice — silently de-duplicating it would
// be a compliance violation. We key on prequalApplicationId + decisionTimestamp
// (pass the upserted row's `updatedAt.toISOString()` — Prisma bumps it on
// every decision write) so each genuine decline yields a unique key while an
// accidental double-send within the same request still de-dupes.
//
// The buyerEmail-only fallback key is retained for callers without an id
// (none today, but kept defensively).
export async function sendAdverseActionEmail(params: {
  to: string;
  firstName: string;
  decisionDate: string;
  prequalApplicationId?: string;
  /** Per-decision salt — typically `updatedAt.toISOString()` of the upserted
   *  PreQualification row. Required whenever prequalApplicationId is provided
   *  so that re-applications produce distinct keys. */
  decisionTimestamp?: string;
  /** Optional full override of the idempotency key — used by the admin
   *  resend endpoint to guarantee every resend is dispatched. Buyer-facing
   *  decision-time callers leave this unset so the per-decision keying
   *  above governs de-duplication. */
  idempotencyKey?: string;
  /** Optional FCRA § 615(a) principal-reason codes from the consumer report —
   *  supplemental detail surfaced in the notice. Required FCRA language is
   *  unchanged whether or not codes are present. */
  adverseReasonCodes?: string[];
}) {
  const defaultKey = params.prequalApplicationId
    ? `adverse-action-${params.prequalApplicationId}-${params.decisionTimestamp ?? params.decisionDate}`
    : `adverse-action-${params.to}`;
  const idempotencyKey = params.idempotencyKey ?? defaultKey;
  return sendIdempotent({
    idempotencyKey,
    to: params.to,
    templateId: "adverse-action",
    subject: ADVERSE_ACTION_SUBJECT,
    html: renderAdverseActionEmail({
      firstName: params.firstName,
      decisionDate: params.decisionDate,
      reasonCodes: params.adverseReasonCodes,
    }),
  });
}

export async function sendDealSelectedEmail(to: string, buyerName: string, dealId: string) {
  void dealId; // used for idempotency key only
  const dashboardUrl = `${APP_URL}/buyer/dashboard`;
  return sendIdempotent({
    idempotencyKey: `deal-selected-${dealId}`,
    to,
    templateId: "deal-selected",
    subject: DEAL_SELECTED_SUBJECT(buyerName),
    html: renderDealSelectedEmail({ firstName: buyerName, dashboardUrl }),
  });
}

export async function sendPickupReadyEmail(to: string, buyerName: string, pickupDate: string) {
  return sendIdempotent({
    idempotencyKey: `pickup-ready-${to}-${pickupDate}`,
    to, templateId: "pickup-ready",
    subject: "Your vehicle is ready for pickup",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0">Vehicle Ready for Pickup</h1>
        </div>
        <div style="padding:32px">
          <p>Hi ${buyerName},</p>
          <p>Your vehicle pickup is scheduled for <strong>${pickupDate}</strong>. Your QR code is available in your dashboard.</p>
          <a href="${APP_URL}/buyer/pickup" style="display:inline-block;background:#4CAF50;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">View QR Code</a>
        </div>
      </div>
    `,
  });
}

export async function sendDepositConfirmationEmail(to: string, firstName: string, depositId: string) {
  const depositDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const auctionsUrl = `${APP_URL}/buyer/auctions`;
  return sendIdempotent({
    idempotencyKey: `deposit-confirmed-${depositId}`,
    to,
    templateId: "deposit-confirmed",
    subject: DEPOSIT_CONFIRMATION_SUBJECT,
    html: renderDepositConfirmationEmail({ firstName, depositId, depositDate, auctionsUrl }),
  });
}

// "Contract signed" confirmation. Sent on DocuSign envelope.completed.
// Idempotency-keyed on the DocuSign envelope id so retried webhook deliveries
// cannot re-send the email.
export async function sendContractSignedEmail(params: {
  to: string;
  firstName: string;
  dealId: string;
  envelopeId: string;
}) {
  const { to, firstName, dealId, envelopeId } = params;
  const dealUrl = `${APP_URL}/buyer/deal`;
  return sendIdempotent({
    idempotencyKey: `contract-signed-${envelopeId}`,
    to,
    templateId: "contract-signed",
    subject: "Your AutoLenis contract is signed",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Contract Signed</h1>
        </div>
        <div style="padding:32px;color:#1f2937;line-height:1.7;font-size:14px">
          <p>Hi ${firstName},</p>
          <p>Your AutoLenis purchase contract has been signed. Your deal is moving to the next stage — we'll be in touch when your pickup is scheduled.</p>
          <a href="${dealUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">View deal status →</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">Reference: deal ${dealId}</p>
        </div>
      </div>
    `,
  });
}

// Concierge / service-fee payment receipt. Uses the idempotent send rail so
// a webhook retry never produces a duplicate receipt for the same PI.
export async function sendConciergeFeeConfirmationEmail(params: {
  to: string;
  firstName: string;
  dealId: string;
  paymentIntentId: string;
}) {
  const { to, firstName, dealId, paymentIntentId } = params;
  const dealUrl = `${APP_URL}/buyer/deal`;
  return sendIdempotent({
    idempotencyKey: `concierge-fee-confirmed-${paymentIntentId}`,
    to,
    templateId: "concierge-fee-confirmed",
    subject: "Your AutoLenis Service Fee Is Confirmed",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Service Fee Confirmed</h1>
        </div>
        <div style="padding:32px;color:#1f2937;line-height:1.7;font-size:14px">
          <p>Hi ${firstName},</p>
          <p>Your AutoLenis Service Fee has been received. Thank you!</p>
          <p style="margin-top:24px;font-weight:600">What happens next</p>
          <ol style="margin:8px 0 24px;padding-left:20px;color:#4B5563">
            <li>We review your financing details (if applicable)</li>
            <li>Your purchase contract is prepared</li>
            <li>You receive a DocuSign link to e-sign your agreement</li>
            <li>Once signed, we coordinate vehicle pickup</li>
          </ol>
          <a href="${dealUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Track your deal →</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">Reference: deal ${dealId}</p>
        </div>
      </div>
    `,
  });
}

// Refund receipt. Sent when a deposit or fee refund is processed.
export async function sendRefundConfirmationEmail(params: {
  to: string;
  firstName: string;
  amountCents: number;
  reason: string;
  /** Stripe refund or charge id — used as idempotency seed so re-processing
   *  the same refund event never emits a duplicate receipt. */
  refundId: string;
}) {
  const { to, firstName, amountCents, reason, refundId } = params;
  const dashboardUrl = `${APP_URL}/buyer/dashboard`;
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return sendIdempotent({
    idempotencyKey: `refund-confirmed-${refundId}`,
    to,
    templateId: "refund-confirmed",
    subject: `Your AutoLenis refund of ${amount} has been processed`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Refund Processed</h1>
        </div>
        <div style="padding:32px;color:#1f2937;line-height:1.7;font-size:14px">
          <p>Hi ${firstName},</p>
          <p>We've processed a refund of <strong>${amount}</strong> back to your original payment method.</p>
          ${reason ? `<p style="background:#F8F9FB;border-left:3px solid #0B5FD1;padding:12px 16px;margin:16px 0;color:#4B5563"><strong>Reason:</strong> ${reason}</p>` : ""}
          <p>Most banks post refunds within 5–10 business days.</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Back to dashboard →</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">Reference: ${refundId}</p>
        </div>
      </div>
    `,
  });
}

export async function sendDealCompleteEmail(to: string, firstName: string, dealId: string) {
  void dealId; // used for idempotency key only
  const completionDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const appUrl = APP_URL;
  return sendIdempotent({
    idempotencyKey: `deal-complete-${dealId}`,
    to,
    templateId: "deal-complete",
    subject: DEAL_COMPLETE_SUBJECT(firstName),
    html: renderDealCompleteEmail({
      firstName,
      completionDate,
      referralCode: "",
      dashboardUrl: `${appUrl}/buyer/dashboard`,
      feedbackUrl: `${appUrl}/feedback`,
      referralUrl: `${appUrl}/auth/signup?ref=`,
      unsubscribeUrl: `${appUrl}/unsubscribe`,
    }),
  });
}

export async function sendEmailVerifiedEmail(params: {
  to: string;
  firstName: string;
}) {
  const { to, firstName } = params;
  const prequalUrl = `${APP_URL}/buyer/prequal`;
  return sendIdempotent({
    idempotencyKey: `email-verified-${to}`,
    to,
    templateId: "email-verified",
    subject: EMAIL_VERIFIED_SUBJECT(firstName),
    html: renderEmailVerifiedEmail({ firstName, prequalUrl }),
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}) {
  const { to, resetUrl } = params;
  // Use an hourly window — one branded reset email per email address per hour.
  const hourWindow = new Date().toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  return sendIdempotent({
    idempotencyKey: `password-reset-${to}-${hourWindow}`,
    to,
    templateId: "password-reset",
    subject: PASSWORD_RESET_SUBJECT,
    html: renderPasswordResetEmail({ resetUrl }),
  });
}

export async function sendContractShieldAlertEmail(params: {
  to: string;
  firstName: string;
  dealId: string;
  issueCount: number;
}) {
  const { to, firstName, dealId, issueCount } = params;
  const contractUrl = `${APP_URL}/buyer/deal/${dealId}/contract`;
  return sendIdempotent({
    idempotencyKey: `contract-shield-alert-${dealId}`,
    to,
    templateId: "contract-shield-alert",
    subject: CONTRACT_SHIELD_ALERT_SUBJECT,
    html: renderContractShieldAlertEmail({ firstName, issueCount, contractUrl }),
  });
}

export async function sendContractApprovedEmail(params: {
  to: string;
  firstName: string;
  dealId: string;
}) {
  const { to, firstName, dealId } = params;
  const signUrl = `${APP_URL}/buyer/deal/${dealId}/sign`;
  return sendIdempotent({
    idempotencyKey: `contract-approved-${dealId}`,
    to,
    templateId: "contract-approved",
    subject: CONTRACT_APPROVED_SUBJECT,
    html: renderContractApprovedEmail({ firstName, signUrl }),
  });
}

// System 4C email templates (8 required)
export async function sendVehicleRequestReceived(to: string, buyerName: string, requestId: string) {
  return sendIdempotent({
    idempotencyKey: `request-received-${requestId}`,
    to, templateId: "4c-request-received",
    subject: "Vehicle request received — AutoLenis",
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px"><p>Hi ${buyerName},</p><p>Your vehicle request has been received. Our team will begin sourcing options and will update you within 3-5 business days.</p><a href="${APP_URL}/buyer/requests/${requestId}">View Request Status</a></div>`,
  });
}

export async function sendVehicleOfferReady(to: string, buyerName: string, requestId: string) {
  return sendIdempotent({
    idempotencyKey: `offer-ready-${requestId}`,
    to, templateId: "4c-offer-ready",
    subject: "A vehicle offer is ready for you — AutoLenis",
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px"><p>Hi ${buyerName},</p><p>Our team has sourced a vehicle matching your request. An offer is ready for your review.</p><a href="${APP_URL}/buyer/requests/${requestId}/offer">View Offer</a></div>`,
  });
}

export async function sendAffiliateVerificationEmail(to: string, firstName: string, referralCode: string, verificationLink?: string) {
  const ctaButton = verificationLink
    ? `<a href="${verificationLink}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Verify my email</a>`
    : `<a href="${APP_URL}/auth/signin" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Sign in</a>`;
  return sendIdempotent({
    idempotencyKey: `affiliate-verify-${to}`,
    to,
    templateId: "affiliate-verification",
    subject: "Verify your email to activate your AutoLenis affiliate account",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0B5FD1;padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Welcome to AutoLenis Affiliates</h1>
        </div>
        <div style="padding:32px">
          <p>Hi ${firstName},</p>
          <p>Thanks for joining the AutoLenis affiliate program. ${verificationLink ? "Click the button below to verify your email — your account will activate immediately." : "Please check for a separate verification email from Supabase to activate your account."}</p>
          ${ctaButton}
          <p style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin:24px 0">
            <strong style="color:#0B5FD1">Your referral code:</strong>
            <span style="font-family:monospace;font-size:18px;color:#111827;margin-left:8px">${referralCode}</span>
            <br/>
            <span style="color:#4B5563;font-size:13px">Once you verify your email, you&rsquo;ll have immediate access to your affiliate dashboard and referral link.</span>
          </p>
          <p style="color:#4B5563;font-size:13px">Commission rates on the ${PREMIUM_FEE_USD} Premium concierge fee: L1 ${L1_PCT_LABEL} &middot; L2 ${L2_PCT_LABEL} &middot; L3 ${L3_PCT_LABEL}.</p>
          <p style="margin-top:24px;color:#94A3B8;font-size:12px">If you didn&rsquo;t apply for an AutoLenis affiliate account, you can safely ignore this email.</p>
        </div>
      </div>
    `,
  });
}

export async function sendAffiliateActivationEmail(to: string, firstName: string, referralCode: string) {
  const appUrl = APP_URL;
  const referralLink = `${appUrl}/auth/signup?ref=${referralCode}`;
  return sendIdempotent({
    idempotencyKey: `affiliate-activate-${to}-${referralCode}`,
    to,
    templateId: "affiliate-activation",
    subject: "You're in — Your AutoLenis affiliate account is active",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#0B5FD1,#0A4DB8);padding:32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px">You're in!</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Your AutoLenis affiliate account is now active.</p>
        </div>
        <div style="padding:32px">
          <p>Hi ${firstName},</p>
          <p>Your application has been approved. You can start sharing your referral link right away.</p>
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:24px 0;text-align:center">
            <p style="margin:0 0 8px;color:#4B5563;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600">Your referral code</p>
            <p style="margin:0;font-family:monospace;font-size:28px;color:#111827;letter-spacing:2px;font-weight:bold">${referralCode}</p>
          </div>
          <p style="color:#4B5563;font-size:14px;margin-bottom:8px"><strong>Shareable link:</strong></p>
          <p style="background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:12px;font-family:monospace;font-size:12px;color:#0B5FD1;word-break:break-all;margin:0 0 24px">${referralLink}</p>
          <a href="${appUrl}/affiliate/portal/dashboard" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;box-shadow:0 4px 12px rgba(100,50,147,0.25)">Go to my dashboard</a>
          <div style="background:#F8F9FB;border-radius:8px;padding:16px;margin-top:32px">
            <p style="margin:0 0 8px;color:#111827;font-size:13px;font-weight:600">How it works</p>
            <ul style="margin:0;padding-left:20px;color:#4B5563;font-size:13px;line-height:1.7">
              <li>Share your link or code with anyone shopping for a car.</li>
              <li>When they complete a deal, you earn <strong>${L1_PCT_LABEL} of the ${PREMIUM_FEE_USD} concierge fee (${L1_PREMIUM_FEE_COMMISSION_USD})</strong>.</li>
              <li>Their referrals earn you L2 (${L2_PCT_LABEL}) and L3 (${L3_PCT_LABEL}) commissions — up to 3 levels deep.</li>
              <li>Payouts process automatically every two weeks.</li>
            </ul>
          </div>
          <p style="margin-top:24px;color:#94A3B8;font-size:12px">Questions? Reply to this email or visit the Compliance Center in your dashboard for FTC disclosure guidelines.</p>
        </div>
      </div>
    `,
  });
}

export async function sendAffiliateRejectionEmail(to: string, firstName: string, reason?: string) {
  const appUrl = APP_URL;
  return sendIdempotent({
    idempotencyKey: `affiliate-reject-${to}-${Date.now()}`,
    to,
    templateId: "affiliate-rejection",
    subject: "Update on your AutoLenis affiliate application",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#F8F9FA;padding:32px;text-align:center;border-bottom:3px solid #0B5FD1">
          <h1 style="color:#111827;margin:0;font-size:22px">Application update</h1>
        </div>
        <div style="padding:32px;color:#4B5563;line-height:1.7">
          <p>Hi ${firstName},</p>
          <p>Thank you for your interest in the AutoLenis affiliate program. After reviewing your application, we're unable to approve it at this time.</p>
          ${reason ? `<p style="background:#F8F9FB;border-left:3px solid #0B5FD1;padding:12px 16px;margin:16px 0;font-size:13px"><strong style="color:#111827">Note from our team:</strong> ${reason}</p>` : ""}
          <p>We review applications on an ongoing basis and typically look for affiliates with:</p>
          <ul style="padding-left:20px;font-size:14px">
            <li>An established platform (blog, social, newsletter, podcast, or community)</li>
            <li>An audience that overlaps with vehicle buyers in the US</li>
            <li>Commitment to the FTC disclosure requirements</li>
          </ul>
          <p>If any of these change in the future, you're welcome to reapply.</p>
          <p>In the meantime, you can still use AutoLenis as a buyer to find your own next vehicle.</p>
          <a href="${appUrl}/for-buyers" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">Explore as a buyer</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">— The AutoLenis Team</p>
        </div>
      </div>
    `,
  });
}

export async function sendAffiliateSuspendedEmail(to: string, firstName: string, reason: string) {
  return sendIdempotent({
    // Per-suspension idempotency key — an affiliate may be suspended more than once.
    idempotencyKey: `affiliate-suspended-${to}-${Date.now()}`,
    to,
    templateId: "affiliate-suspended",
    subject: "Your AutoLenis affiliate account has been suspended",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#FEF2F2;padding:32px;text-align:center;border-bottom:3px solid #DC2626">
          <h1 style="color:#111827;margin:0;font-size:22px">Account suspended</h1>
        </div>
        <div style="padding:32px;color:#4B5563;line-height:1.7">
          <p>Hi ${firstName},</p>
          <p>Your AutoLenis affiliate account has been suspended. While suspended, your referral links remain active for attribution but you will not accrue new commissions and payouts are paused.</p>
          <p style="background:#F8F9FB;border-left:3px solid #DC2626;padding:12px 16px;margin:16px 0;font-size:13px"><strong style="color:#111827">Reason:</strong> ${reason}</p>
          <p>If you believe this is a mistake or would like to discuss reinstatement, please contact our team.</p>
          <a href="mailto:support@autolenis.com" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">Contact Support</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">— The AutoLenis Team</p>
        </div>
      </div>
    `,
  });
}

export async function sendAffiliateReinstatedEmail(to: string, firstName: string) {
  const appUrl = APP_URL;
  return sendIdempotent({
    // Per-reinstatement idempotency key — repeat suspend→reinstate cycles each send.
    idempotencyKey: `affiliate-reinstated-${to}-${Date.now()}`,
    to,
    templateId: "affiliate-reinstated",
    subject: "Your AutoLenis affiliate account has been reinstated",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#F0FDF4;padding:32px;text-align:center;border-bottom:3px solid #16A34A">
          <h1 style="color:#111827;margin:0;font-size:22px">Welcome back</h1>
        </div>
        <div style="padding:32px;color:#4B5563;line-height:1.7">
          <p>Hi ${firstName},</p>
          <p>Good news — your AutoLenis affiliate account has been reinstated and is active again. You can resume sharing your referral link and earning commissions right away.</p>
          <a href="${appUrl}/affiliate/portal/dashboard" style="display:inline-block;background:#0B5FD1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:8px">Go to my dashboard</a>
          <p style="margin-top:32px;color:#94A3B8;font-size:12px">— The AutoLenis Team</p>
        </div>
      </div>
    `,
  });
}

export async function sendAffiliateWeeklyDigest(input: {
  to: string;
  firstName: string;
  referralCode: string;
  weekKey: string;  // e.g. "2026-W17" — used in idempotency key
  activity: { l1: { count: number; cents: number }; l2: { count: number; cents: number }; l3: { count: number; cents: number } };
  newJoins: number;
  totalEarnedCents: number;
  pendingPayoutCents: number;
  unsubscribeToken: string;
}) {
  const appUrl = APP_URL;
  const referralLink = `${appUrl}/auth/signup?ref=${input.referralCode}`;
  const unsubscribeLink = `${appUrl}/api/public/affiliate/unsubscribe?token=${input.unsubscribeToken}`;
  const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const periodCents = input.activity.l1.cents + input.activity.l2.cents + input.activity.l3.cents;
  const hasActivity = input.activity.l1.count + input.activity.l2.count + input.activity.l3.count > 0;

  return sendIdempotent({
    idempotencyKey: `affiliate-digest-${input.to}-${input.weekKey}`,
    to: input.to,
    templateId: "affiliate-weekly-digest",
    subject: hasActivity
      ? `Your AutoLenis week: ${dollars(periodCents)} earned`
      : `Your AutoLenis affiliate week — ${input.newJoins} new referral${input.newJoins === 1 ? "" : "s"}`,
    html: `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:linear-gradient(135deg,#0B5FD1,#0A4DB8);padding:28px 32px">
          <p style="margin:0;color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">Your weekly recap · ${input.weekKey}</p>
          <h1 style="margin:4px 0 0;color:#fff;font-size:24px;letter-spacing:-0.01em">Hi ${input.firstName},</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.82);font-size:14px">Here's what happened in your network this week.</p>
        </div>

        <div style="padding:28px 32px">
          <!-- Commission activity -->
          <p style="margin:0 0 12px;color:#111827;font-size:14px;font-weight:600">This week's earnings</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">
            <tr>
              <td style="width:33%;padding:12px;background:#F8F9FB;border-radius:8px 0 0 8px;border-right:1px solid #fff">
                <p style="margin:0;color:#94A3B8;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px">L1 Direct</p>
                <p style="margin:4px 0 0;color:#111827;font-family:monospace;font-size:20px;font-weight:700">${dollars(input.activity.l1.cents)}</p>
                <p style="margin:2px 0 0;color:#4B5563;font-size:11px">${input.activity.l1.count} commission${input.activity.l1.count === 1 ? "" : "s"}</p>
              </td>
              <td style="width:33%;padding:12px;background:#F8F9FB;border-right:1px solid #fff">
                <p style="margin:0;color:#94A3B8;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px">L2 Network</p>
                <p style="margin:4px 0 0;color:#111827;font-family:monospace;font-size:20px;font-weight:700">${dollars(input.activity.l2.cents)}</p>
                <p style="margin:2px 0 0;color:#4B5563;font-size:11px">${input.activity.l2.count} commission${input.activity.l2.count === 1 ? "" : "s"}</p>
              </td>
              <td style="width:33%;padding:12px;background:#F8F9FB;border-radius:0 8px 8px 0">
                <p style="margin:0;color:#94A3B8;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px">L3 Extended</p>
                <p style="margin:4px 0 0;color:#111827;font-family:monospace;font-size:20px;font-weight:700">${dollars(input.activity.l3.cents)}</p>
                <p style="margin:2px 0 0;color:#4B5563;font-size:11px">${input.activity.l3.count} commission${input.activity.l3.count === 1 ? "" : "s"}</p>
              </td>
            </tr>
          </table>
          <p style="margin:6px 0 24px;color:#4B5563;font-size:12px"><strong>${dollars(periodCents)}</strong> earned this week across ${input.activity.l1.count + input.activity.l2.count + input.activity.l3.count} deal${input.activity.l1.count + input.activity.l2.count + input.activity.l3.count === 1 ? "" : "s"}.</p>

          <!-- Network growth -->
          <div style="background:#EDF6FD;border:1px solid #C7E0F4;border-radius:8px;padding:16px;margin-bottom:24px">
            <p style="margin:0;color:#111827;font-size:14px;font-weight:600">
              ${input.newJoins} new referral${input.newJoins === 1 ? "" : "s"} joined your tree
            </p>
            <p style="margin:4px 0 0;color:#4B5563;font-size:12px">L1 + L2 + L3 depth · this week</p>
          </div>

          <!-- Lifetime totals -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:28px">
            <tr>
              <td style="width:50%;padding:14px 16px;border:1px solid #E5E7EB;border-radius:8px 0 0 8px;border-right:none">
                <p style="margin:0;color:#94A3B8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Total earned</p>
                <p style="margin:4px 0 0;color:#1A6B18;font-family:monospace;font-size:22px;font-weight:700">${dollars(input.totalEarnedCents)}</p>
              </td>
              <td style="width:50%;padding:14px 16px;border:1px solid #E5E7EB;border-radius:0 8px 8px 0">
                <p style="margin:0;color:#94A3B8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Pending payout</p>
                <p style="margin:4px 0 0;color:#0B5FD1;font-family:monospace;font-size:22px;font-weight:700">${dollars(input.pendingPayoutCents)}</p>
              </td>
            </tr>
          </table>

          <!-- Primary CTA -->
          <div style="text-align:center;margin-bottom:28px">
            <a href="${appUrl}/affiliate/portal/dashboard" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(100,50,147,0.25)" data-testid="digest-primary-cta">
              View Your Dashboard →
            </a>
          </div>

          <!-- Referral share block -->
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin-bottom:24px">
            <p style="margin:0 0 4px;color:#111827;font-size:13px;font-weight:600">Keep the momentum going</p>
            <p style="margin:0 0 10px;color:#4B5563;font-size:12px">Share your link with anyone shopping for a vehicle.</p>
            <p style="margin:0 0 12px;background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;font-family:monospace;font-size:11px;color:#0B5FD1;word-break:break-all">${referralLink}</p>
            <a href="${referralLink}" style="display:inline-block;background:#fff;color:#0B5FD1;border:1.5px solid #0B5FD1;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px" data-testid="digest-share-cta">
              Share Your Link
            </a>
          </div>

          <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6">
            Referral code: <code style="font-family:monospace;color:#0B5FD1">${input.referralCode}</code><br/>
            Commissions process automatically every two weeks to your connected payout method.
          </p>
        </div>

        <!-- Footer with compliant unsubscribe -->
        <div style="background:#F8F9FA;padding:20px 32px;border-top:1px solid #E5E7EB;text-align:center">
          <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6">
            You're receiving this because you're an active AutoLenis affiliate.<br/>
            <a href="${unsubscribeLink}" style="color:#94A3B8;text-decoration:underline" data-testid="digest-unsubscribe-link">Unsubscribe from the weekly digest</a>
            &nbsp;·&nbsp;
            <a href="${appUrl}/legal/privacy" style="color:#94A3B8;text-decoration:underline">Privacy</a>
          </p>
          <p style="margin:8px 0 0;color:#93C5FD;font-size:10px">AutoLenis, Inc.</p>
        </div>
      </div>
    `,
  });
}

// ─── Dealer Application & Invitation Emails ──────────────────────────────────

export async function sendDealerApplicationReceived(
  contactEmail: string,
  contactName: string,
  dealershipName: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `dealer-app-received:${contactEmail}`,
    to: contactEmail,
    subject: "We received your AutoLenis dealer application",
    templateId: "dealer-application-received",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Application Received</h1>
          <p style="margin:8px 0 0;color:#93C5FD;font-size:14px">AutoLenis Dealer Network</p>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${contactName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Thank you for applying to join the <strong>AutoLenis Dealer Network</strong> with <strong>${dealershipName}</strong>. Our team will review your application within 2 business days.</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Once approved, you will receive an email with your login credentials to access your dealer portal.</p>
          <p style="color:#94A3B8;font-size:13px;margin-top:24px">Questions? Reply to this email or visit autolenis.com.</p>
        </div>
        <div style="background:#F8F9FA;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center">
          <p style="margin:0;color:#94A3B8;font-size:11px">AutoLenis, Inc.</p>
        </div>
      </div>
    `,
  });
}

export async function sendDealerApplicationAdminNotification(
  adminEmail: string,
  applicationData: { contactName: string; contactEmail: string; dealershipName: string; state: string; appId: string }
): Promise<void> {
  const appUrl = APP_URL;
  await sendIdempotent({
    idempotencyKey: `dealer-app-admin:${applicationData.appId}`,
    to: adminEmail,
    subject: `New Dealer Application: ${applicationData.dealershipName}`,
    templateId: "dealer-application-admin",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto">
        <h2 style="color:#111827">New Dealer Application</h2>
        <p><strong>Dealership:</strong> ${applicationData.dealershipName}</p>
        <p><strong>Contact:</strong> ${applicationData.contactName} &lt;${applicationData.contactEmail}&gt;</p>
        <p><strong>State:</strong> ${applicationData.state}</p>
        <div style="margin-top:24px">
          <a href="${appUrl}/admin/dealers?tab=applications" style="background:#0B5FD1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Review Application →</a>
        </div>
      </div>
    `,
  });
}

export async function sendDealerApprovalEmail(
  dealerEmail: string,
  contactName: string,
  temporaryPassword: string,
  signinUrl: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `dealer-approved:${dealerEmail}`,
    to: dealerEmail,
    subject: "Your AutoLenis Dealer Account is Approved",
    templateId: "dealer-approved",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Application Approved!</h1>
          <p style="margin:8px 0 0;color:#93C5FD;font-size:14px">Welcome to the AutoLenis Dealer Network</p>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${contactName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Your dealer application has been <strong style="color:#16a34a">approved</strong>. Use the credentials below to sign in and complete your onboarding.</p>
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:20px 0">
            <p style="margin:0 0 8px;color:#111827;font-size:13px"><strong>Login Email:</strong> ${dealerEmail}</p>
            <p style="margin:0;color:#111827;font-size:13px"><strong>Temporary Password:</strong> <code style="font-family:monospace;background:#fff;border:1px solid #E5E7EB;padding:2px 8px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="${signinUrl}" style="background:#0B5FD1;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Sign In to Dealer Portal →</a>
          </div>
          <p style="color:#94A3B8;font-size:13px">Please change your password after first login.</p>
        </div>
      </div>
    `,
  });
}

export async function sendDealerRejectionEmail(
  dealerEmail: string,
  contactName: string,
  reason?: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `dealer-rejected:${dealerEmail}`,
    to: dealerEmail,
    subject: "Update on Your AutoLenis Dealer Application",
    templateId: "dealer-rejected",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Application Update</h1>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${contactName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Thank you for your interest in the AutoLenis Dealer Network. After careful review, we are unable to approve your application at this time.</p>
          ${reason ? `<p style="color:#4B5563;font-size:14px;line-height:1.7"><strong>Reason:</strong> ${reason}</p>` : ""}
          <p style="color:#4B5563;font-size:14px;line-height:1.7">If you believe this was a mistake, please contact us at support@autolenis.com.</p>
        </div>
      </div>
    `,
  });
}

export async function sendAdminCreatedBuyerEmail(
  buyerEmail: string,
  firstName: string,
  temporaryPassword: string,
  loginUrl: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `admin-created-buyer:${buyerEmail}`,
    to: buyerEmail,
    subject: "Your AutoLenis Buyer Account",
    templateId: "admin-created-buyer",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Account Created</h1>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${firstName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">An AutoLenis buyer account has been created for you.</p>
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:20px 0">
            <p style="margin:0 0 8px;color:#111827;font-size:13px"><strong>Email:</strong> ${buyerEmail}</p>
            <p style="margin:0;color:#111827;font-size:13px"><strong>Temporary Password:</strong> <code style="font-family:monospace;background:#fff;border:1px solid #E5E7EB;padding:2px 8px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="${loginUrl}" style="background:#0B5FD1;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Sign In →</a>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendAdminCreatedDealerEmail(
  dealerEmail: string,
  contactName: string,
  temporaryPassword: string,
  loginUrl: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `admin-created-dealer:${dealerEmail}`,
    to: dealerEmail,
    subject: "Your AutoLenis Dealer Account",
    templateId: "admin-created-dealer",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Dealer Account Created</h1>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${contactName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Your AutoLenis dealer account has been created by an administrator.</p>
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:20px 0">
            <p style="margin:0 0 8px;color:#111827;font-size:13px"><strong>Email:</strong> ${dealerEmail}</p>
            <p style="margin:0;color:#111827;font-size:13px"><strong>Temporary Password:</strong> <code style="font-family:monospace;background:#fff;border:1px solid #E5E7EB;padding:2px 8px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="${loginUrl}" style="background:#0B5FD1;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Sign In to Dealer Portal →</a>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendAdminCreatedAffiliateEmail(
  affiliateEmail: string,
  firstName: string,
  referralCode: string,
  temporaryPassword: string,
  loginUrl: string
): Promise<void> {
  await sendIdempotent({
    idempotencyKey: `admin-created-affiliate:${affiliateEmail}`,
    to: affiliateEmail,
    subject: "Your AutoLenis Affiliate Account",
    templateId: "admin-created-affiliate",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#111827;padding:32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Affiliate Account Created</h1>
        </div>
        <div style="padding:32px">
          <p style="color:#1a1a2e;font-size:15px">Hi ${firstName},</p>
          <p style="color:#4B5563;font-size:14px;line-height:1.7">Your AutoLenis affiliate account is ready.</p>
          <div style="background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin:20px 0">
            <p style="margin:0 0 8px;color:#111827;font-size:13px"><strong>Email:</strong> ${affiliateEmail}</p>
            <p style="margin:0 0 8px;color:#111827;font-size:13px"><strong>Temporary Password:</strong> <code style="font-family:monospace;background:#fff;border:1px solid #E5E7EB;padding:2px 8px;border-radius:4px">${temporaryPassword}</code></p>
            <p style="margin:0;color:#111827;font-size:13px"><strong>Referral Code:</strong> <code style="font-family:monospace;font-size:18px;color:#0B5FD1">${referralCode}</code></p>
          </div>
          <div style="text-align:center;margin:24px 0">
            <a href="${loginUrl}" style="background:#0B5FD1;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Sign In →</a>
          </div>
        </div>
      </div>
    `,
  });
}

// ─── Dealer Email Templates ─────────────────────────────────────────────────

export async function sendDealerApplicationReceivedEmail(params: {
  to: string; dealershipName: string; contactName: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-app-received-${params.to}`,
    to: params.to,
    templateId: "dealer-application-received",
    subject: DEALER_APPLICATION_RECEIVED_SUBJECT,
    html: renderDealerApplicationReceivedEmail({ dealershipName: params.dealershipName, contactName: params.contactName }),
  });
}

export async function sendDealerApplicationApprovedEmail(params: {
  to: string; contactName: string; dealershipName: string; claimUrl: string; expiresAt: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-app-approved-${params.to}`,
    to: params.to,
    templateId: "dealer-application-approved",
    subject: DEALER_APPLICATION_APPROVED_SUBJECT,
    html: renderDealerApplicationApprovedEmail({ contactName: params.contactName, dealershipName: params.dealershipName, claimUrl: params.claimUrl, expiresAt: params.expiresAt }),
  });
}

export async function sendDealerApplicationRejectedEmail(params: {
  to: string; contactName: string; dealershipName: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-app-rejected-${params.to}`,
    to: params.to,
    templateId: "dealer-application-rejected",
    subject: DEALER_APPLICATION_REJECTED_SUBJECT,
    html: renderDealerApplicationRejectedEmail({ contactName: params.contactName, dealershipName: params.dealershipName }),
  });
}

export async function sendDealerInvitationEmail(params: {
  to: string; contactName: string; dealershipName: string; claimUrl: string; expiresAt: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-invitation-${params.to}`,
    to: params.to,
    templateId: "dealer-invitation",
    subject: DEALER_INVITATION_SUBJECT,
    html: renderDealerInvitationEmail({ contactName: params.contactName, dealershipName: params.dealershipName, claimUrl: params.claimUrl, expiresAt: params.expiresAt }),
  });
}

export async function sendDealerWelcomeEmail(params: {
  to: string; contactName: string; dealershipName: string; dashboardUrl: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-welcome-${params.to}`,
    to: params.to,
    templateId: "dealer-welcome",
    subject: DEALER_WELCOME_SUBJECT,
    html: renderDealerWelcomeEmail({ contactName: params.contactName, dealershipName: params.dealershipName, dashboardUrl: params.dashboardUrl }),
  });
}

export async function sendDealerAgreementPendingEmail(params: {
  to: string; contactName: string; dealershipName: string; signingUrl: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-agreement-pending-${params.to}`,
    to: params.to,
    templateId: "dealer-agreement-pending",
    subject: DEALER_AGREEMENT_PENDING_SUBJECT,
    html: renderDealerAgreementPendingEmail({ contactName: params.contactName, dealershipName: params.dealershipName, signingUrl: params.signingUrl }),
  });
}

export async function sendDealerAccountApprovedEmail(params: {
  to: string; contactName: string; dealershipName: string; dashboardUrl: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-account-approved-${params.to}`,
    to: params.to,
    templateId: "dealer-account-approved",
    subject: DEALER_ACCOUNT_APPROVED_SUBJECT,
    html: renderDealerAccountApprovedEmail({ contactName: params.contactName, dealershipName: params.dealershipName, dashboardUrl: params.dashboardUrl }),
  });
}

export async function sendDealerAccountSuspendedEmail(params: {
  to: string; contactName: string; dealershipName: string; reasonCategory: string; adminContactEmail: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-account-suspended-${params.to}-${Date.now()}`,
    to: params.to,
    templateId: "dealer-account-suspended",
    subject: DEALER_ACCOUNT_SUSPENDED_SUBJECT,
    html: renderDealerAccountSuspendedEmail({ contactName: params.contactName, dealershipName: params.dealershipName, reasonCategory: params.reasonCategory, adminContactEmail: params.adminContactEmail }),
  });
}

export async function sendDealerAccountReinstatedEmail(params: {
  to: string; contactName: string; dealershipName: string; dashboardUrl: string;
}) {
  return sendIdempotent({
    // Per-reinstatement idempotency key — a dealer may be suspended and
    // reinstated more than once over their lifetime.
    idempotencyKey: `dealer-account-reinstated-${params.to}-${Date.now()}`,
    to: params.to,
    templateId: "dealer-account-reinstated",
    subject: DEALER_ACCOUNT_REINSTATED_SUBJECT,
    html: renderDealerAccountReinstatedEmail({ contactName: params.contactName, dealershipName: params.dealershipName, dashboardUrl: params.dashboardUrl }),
  });
}

export async function sendDealerAccountTerminatedEmail(params: {
  to: string; contactName: string; dealershipName: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-account-terminated-${params.to}`,
    to: params.to,
    templateId: "dealer-account-terminated",
    subject: DEALER_ACCOUNT_TERMINATED_SUBJECT,
    html: renderDealerAccountTerminatedEmail({ contactName: params.contactName, dealershipName: params.dealershipName }),
  });
}

export async function sendDealerAuctionInvitationEmail(params: {
  to: string; contactName: string; vehicleMake: string; vehicleModel: string; vehicleYear: number; vehicleTrim: string | null; buyerCity: string; buyerState: string; auctionUrl: string; expiryHours: number; auctionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-auction-invitation-${params.auctionId}-${params.to}`,
    to: params.to,
    templateId: "dealer-auction-invitation",
    subject: DEALER_AUCTION_INVITATION_SUBJECT(params.vehicleYear, params.vehicleMake, params.vehicleModel),
    html: renderDealerAuctionInvitationEmail({ contactName: params.contactName, vehicleMake: params.vehicleMake, vehicleModel: params.vehicleModel, vehicleYear: params.vehicleYear, vehicleTrim: params.vehicleTrim, buyerCity: params.buyerCity, buyerState: params.buyerState, auctionUrl: params.auctionUrl, expiryHours: params.expiryHours }),
  });
}

export async function sendDealerAuctionReminderEmail(params: {
  to: string; contactName: string; vehicleMake: string; vehicleModel: string; vehicleYear: number; auctionUrl: string; hoursRemaining: number; auctionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-auction-reminder-${params.auctionId}-${params.to}`,
    to: params.to,
    templateId: "dealer-auction-reminder",
    subject: DEALER_AUCTION_REMINDER_SUBJECT(params.hoursRemaining, params.vehicleYear, params.vehicleMake, params.vehicleModel),
    html: renderDealerAuctionReminderEmail({ contactName: params.contactName, vehicleMake: params.vehicleMake, vehicleModel: params.vehicleModel, vehicleYear: params.vehicleYear, auctionUrl: params.auctionUrl, hoursRemaining: params.hoursRemaining }),
  });
}

export async function sendDealerOfferSubmittedEmail(params: {
  to: string; contactName: string; vehicleRef: string; otdPriceCents: number; submittedAt: string; revisionWindowExpiry: string; offerId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-offer-submitted-${params.offerId}`,
    to: params.to,
    templateId: "dealer-offer-submitted",
    subject: DEALER_OFFER_SUBMITTED_SUBJECT,
    html: renderDealerOfferSubmittedEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, otdPriceCents: params.otdPriceCents, submittedAt: params.submittedAt, revisionWindowExpiry: params.revisionWindowExpiry }),
  });
}

export async function sendDealerOfferRevisionClosingEmail(params: {
  to: string; contactName: string; vehicleRef: string; auctionUrl: string; offerId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-offer-revision-closing-${params.offerId}`,
    to: params.to,
    templateId: "dealer-offer-revision-closing",
    subject: DEALER_OFFER_REVISION_CLOSING_SUBJECT,
    html: renderDealerOfferRevisionClosingEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, auctionUrl: params.auctionUrl }),
  });
}

export async function sendDealerOfferWonEmail(params: {
  to: string; contactName: string; vehicleRef: string; buyerFirstName: string; buyerLastInitial: string; dealUrl: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-offer-won-${params.dealId}`,
    to: params.to,
    templateId: "dealer-offer-won",
    subject: DEALER_OFFER_WON_SUBJECT(params.vehicleRef),
    html: renderDealerOfferWonEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, buyerFirstName: params.buyerFirstName, buyerLastInitial: params.buyerLastInitial, dealUrl: params.dealUrl }),
  });
}

export async function sendDealerOfferLostEmail(params: {
  to: string; contactName: string; vehicleRef: string; yourPosition: number; totalOffers: number; insightsUrl: string; auctionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-offer-lost-${params.auctionId}-${params.to}`,
    to: params.to,
    templateId: "dealer-offer-lost",
    subject: DEALER_OFFER_LOST_SUBJECT,
    html: renderDealerOfferLostEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, yourPosition: params.yourPosition, totalOffers: params.totalOffers, insightsUrl: params.insightsUrl }),
  });
}

export async function sendDealerAuctionClosedNoWinnerEmail(params: {
  to: string; contactName: string; vehicleRef: string; auctionId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-auction-closed-no-winner-${params.auctionId}-${params.to}`,
    to: params.to,
    templateId: "dealer-auction-closed-no-winner",
    subject: DEALER_AUCTION_CLOSED_NO_WINNER_SUBJECT,
    html: renderDealerAuctionClosedNoWinnerEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, auctionId: params.auctionId }),
  });
}

export async function sendDealerContractPendingEmail(params: {
  to: string; contactName: string; dealId: string; vehicleRef: string; uploadUrl: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-contract-pending-${params.dealId}`,
    to: params.to,
    templateId: "dealer-contract-pending",
    subject: DEALER_CONTRACT_PENDING_SUBJECT,
    html: renderDealerContractPendingEmail({ contactName: params.contactName, dealId: params.dealId, vehicleRef: params.vehicleRef, uploadUrl: params.uploadUrl }),
  });
}

export async function sendDealerContractIssuesEmail(params: {
  to: string; contactName: string; vehicleRef: string; fixItems: string[]; contractUrl: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-contract-issues-${params.dealId}-${Date.now()}`,
    to: params.to,
    templateId: "dealer-contract-issues",
    subject: DEALER_CONTRACT_ISSUES_SUBJECT,
    html: renderDealerContractIssuesEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, fixItems: params.fixItems, contractUrl: params.contractUrl }),
  });
}

export async function sendDealerEsignInitiatedEmail(params: {
  to: string; contactName: string; vehicleRef: string; signingUrl: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-esign-initiated-${params.dealId}`,
    to: params.to,
    templateId: "dealer-esign-initiated",
    subject: DEALER_ESIGN_INITIATED_SUBJECT,
    html: renderDealerEsignInitiatedEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, signingUrl: params.signingUrl }),
  });
}

export async function sendDealerPickupScheduledEmail(params: {
  to: string; contactName: string; vehicleRef: string; buyerCity: string; buyerState: string; pickupWindow: string; dealUrl: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-pickup-scheduled-${params.dealId}`,
    to: params.to,
    templateId: "dealer-pickup-scheduled",
    subject: DEALER_PICKUP_SCHEDULED_SUBJECT(params.vehicleRef),
    html: renderDealerPickupScheduledEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, buyerCity: params.buyerCity, buyerState: params.buyerState, pickupWindow: params.pickupWindow, dealUrl: params.dealUrl }),
  });
}

export async function sendDealerPickupCompletedEmail(params: {
  to: string; contactName: string; vehicleRef: string; payoutSchedule: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-pickup-completed-${params.dealId}`,
    to: params.to,
    templateId: "dealer-pickup-completed",
    subject: DEALER_PICKUP_COMPLETED_SUBJECT,
    html: renderDealerPickupCompletedEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, payoutSchedule: params.payoutSchedule }),
  });
}

export async function sendDealerPayoutInitiatedEmail(params: {
  to: string; contactName: string; vehicleRef: string; amountCents: number; estimatedArrival: string; payoutId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-payout-initiated-${params.payoutId}`,
    to: params.to,
    templateId: "dealer-payout-initiated",
    subject: DEALER_PAYOUT_INITIATED_SUBJECT,
    html: renderDealerPayoutInitiatedEmail({ contactName: params.contactName, vehicleRef: params.vehicleRef, amountCents: params.amountCents, estimatedArrival: params.estimatedArrival }),
  });
}

export async function sendDealerWeeklyScorecardEmail(params: {
  to: string; contactName: string; dealershipName: string; winRate: number; avgResponseTimeHours: number; offersSubmitted: number; currentTier: string; scorecardUrl: string; weekKey: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-weekly-scorecard-${params.to}-${params.weekKey}`,
    to: params.to,
    templateId: "dealer-weekly-scorecard",
    subject: DEALER_WEEKLY_SCORECARD_SUBJECT,
    html: renderDealerWeeklyScorecardEmail({ contactName: params.contactName, dealershipName: params.dealershipName, winRate: params.winRate, avgResponseTimeHours: params.avgResponseTimeHours, offersSubmitted: params.offersSubmitted, currentTier: params.currentTier, scorecardUrl: params.scorecardUrl }),
  });
}

export async function sendDealerInventorySyncFailureEmail(params: {
  to: string; contactName: string; lastSuccessfulSync: string; errorCategory: string; feedSetupUrl: string;
}) {
  const hourWindow = new Date().toISOString().slice(0, 13);
  return sendIdempotent({
    idempotencyKey: `dealer-inventory-sync-failure-${params.to}-${hourWindow}`,
    to: params.to,
    templateId: "dealer-inventory-sync-failure",
    subject: DEALER_INVENTORY_SYNC_FAILURE_SUBJECT,
    html: renderDealerInventorySyncFailureEmail({ contactName: params.contactName, lastSuccessfulSync: params.lastSuccessfulSync, errorCategory: params.errorCategory, feedSetupUrl: params.feedSetupUrl }),
  });
}

export async function sendDealerStaleListingRemovalEmail(params: {
  to: string; contactName: string; affectedVehicles: Array<{ year: number; make: string; model: string }>; reason: string; inventoryUrl: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-stale-listing-${params.to}-${Date.now()}`,
    to: params.to,
    templateId: "dealer-stale-listing-removal",
    subject: DEALER_STALE_LISTING_REMOVAL_SUBJECT,
    html: renderDealerStaleListingRemovalEmail({ contactName: params.contactName, affectedVehicles: params.affectedVehicles, reason: params.reason, inventoryUrl: params.inventoryUrl }),
  });
}

export async function sendDealerComplianceNoticeEmail(params: {
  to: string; contactName: string; noticeDate: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-compliance-notice-${params.to}-${params.noticeDate}`,
    to: params.to,
    templateId: "dealer-compliance-notice",
    subject: DEALER_COMPLIANCE_NOTICE_SUBJECT,
    html: renderDealerComplianceNoticeEmail({ contactName: params.contactName, noticeDate: params.noticeDate }),
  });
}

export async function sendDealerPasswordResetEmail(params: {
  to: string; contactName: string; resetUrl: string;
}) {
  const hourWindow = new Date().toISOString().slice(0, 13);
  return sendIdempotent({
    idempotencyKey: `dealer-password-reset-${params.to}-${hourWindow}`,
    to: params.to,
    templateId: "dealer-password-reset",
    subject: DEALER_PASSWORD_RESET_SUBJECT,
    html: renderDealerPasswordResetEmail({ contactName: params.contactName, resetUrl: params.resetUrl }),
  });
}

export async function sendDealerNewBuyerOpportunityEmail(params: {
  to: string; contactName: string; vehicleInterest: string; buyerCity: string; buyerState: string; opportunityUrl: string; opportunityId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `dealer-new-buyer-opportunity-${params.opportunityId}-${params.to}`,
    to: params.to,
    templateId: "dealer-new-buyer-opportunity",
    subject: DEALER_NEW_BUYER_OPPORTUNITY_SUBJECT,
    html: renderDealerNewBuyerOpportunityEmail({ contactName: params.contactName, vehicleInterest: params.vehicleInterest, buyerCity: params.buyerCity, buyerState: params.buyerState, opportunityUrl: params.opportunityUrl }),
  });
}

// ─── Admin Payment Link Emails ────────────────────────────────────────────────

export async function sendDepositPaymentLinkEmail(params: {
  to: string; firstName: string; checkoutUrl: string; depositId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `deposit-payment-link-${params.depositId}`,
    to: params.to,
    templateId: "admin-deposit-payment-link",
    subject: DEPOSIT_PAYMENT_LINK_SUBJECT,
    html: renderDepositPaymentLinkEmail({ firstName: params.firstName, checkoutUrl: params.checkoutUrl, appUrl: APP_URL }),
  });
}

export async function sendConciergeFeePaymentLinkEmail(params: {
  to: string; firstName: string; checkoutUrl: string; dealId: string;
}) {
  return sendIdempotent({
    idempotencyKey: `concierge-fee-payment-link-${params.dealId}`,
    to: params.to,
    templateId: "admin-concierge-fee-payment-link",
    subject: CONCIERGE_FEE_PAYMENT_LINK_SUBJECT,
    html: renderConciergeFeePaymentLinkEmail({ firstName: params.firstName, checkoutUrl: params.checkoutUrl, appUrl: APP_URL }),
  });
}

// ─── Admin Custom Email ───────────────────────────────────────────────────────

export async function sendCustomAdminEmail(params: {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<{ sent: boolean; resendId?: string }> {
  return sendIdempotent({
    idempotencyKey: params.idempotencyKey,
    to: params.to,
    templateId: "admin-custom-email",
    subject: params.subject,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px">${params.body}</div>`,
  });
}

// ─── Social Lead emails (Social Intelligence & Media Engine) ─────────────────
// Welcome + 5-step nurture for buyers captured from social campaign landing
// pages (/lp/*). Mobile-responsive, AutoLenis brand styling, primary button in
// #0B5FD1, unsubscribe footer on every send. Driven by the request-vehicle
// intake (welcome) and the social-lead-nurture cron (nurture steps 1–5).

const SOCIAL_REQUEST_URL = `${APP_URL}/request-a-car`;
const SOCIAL_HOW_IT_WORKS_URL = `${APP_URL}/how-it-works`;

// Shared brand wrapper so every social email looks identical to the rest of the
// AutoLenis transactional email family (header bar, body, CTA, footer).
function renderSocialEmail(params: {
  to: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(params.to)}`;
  return `
    <div style="font-family:-apple-system,system-ui,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
      <div style="background:#0B5FD1;padding:32px 24px;text-align:center">
        <h1 style="color:#ffffff;margin:0;font-size:22px;line-height:1.3">${params.heading}</h1>
      </div>
      <div style="padding:32px 24px;color:#1f2937;line-height:1.7;font-size:15px">
        ${params.bodyHtml}
        <div style="text-align:center;margin:32px 0 8px">
          <a href="${params.ctaUrl}" style="display:inline-block;background:#0B5FD1;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">${params.ctaLabel}</a>
        </div>
      </div>
      <div style="padding:20px 24px;border-top:1px solid #E5E7EB;text-align:center">
        <p style="margin:0 0 6px;color:#94A3B8;font-size:12px">Questions? Just reply to this email — a real person reads it.</p>
        <p style="margin:0;color:#94A3B8;font-size:12px">© ${new Date().getFullYear()} AutoLenis, Inc. &middot; <a href="${unsubscribeUrl}" style="color:#94A3B8;text-decoration:underline">Unsubscribe</a></p>
      </div>
    </div>
  `;
}

// Day-0 welcome — fired at intake for social-sourced submissions. Idempotency
// is keyed on email + campaign so a same-campaign double submit never
// double-welcomes, while a later distinct campaign can still greet the buyer.
export async function sendSocialLeadWelcomeEmail(params: {
  to: string;
  firstName: string;
  vehicleInterest?: string;
  campaign: string;
  platform?: string;
}): Promise<EmailSendOutcome> {
  const { to, firstName, vehicleInterest, campaign } = params;
  const interestLine = vehicleInterest
    ? `<p style="background:#F8F9FB;border-left:3px solid #0B5FD1;padding:12px 16px;margin:16px 0;color:#4B5563"><strong>You're looking for:</strong> ${vehicleInterest}</p>`
    : "";
  const bodyHtml = `
    <p>Hi ${firstName},</p>
    <p>Great news — we just received your vehicle request and we're already reaching out to qualified dealers in your area.</p>
    ${interestLine}
    <p style="font-weight:600;margin-top:20px">Here's what happens next:</p>
    <ul style="margin:8px 0 16px;padding-left:20px;color:#4B5563;line-height:1.9">
      <li>We contact qualified local dealers on your behalf</li>
      <li>Dealers submit their best competing offers privately</li>
      <li>You compare offers side by side — no pressure ever</li>
    </ul>
    <p>Most buyers receive their first dealer offer within 24 hours.</p>
  `;
  return sendIdempotent({
    idempotencyKey: `social-welcome-${to}-${campaign}`.toLowerCase(),
    to,
    templateId: "social-lead-welcome",
    subject: `We're on it, ${firstName} 🚀`,
    html: renderSocialEmail({
      to,
      heading: "Your request is in motion",
      bodyHtml,
      ctaLabel: "Track My Request",
      ctaUrl: SOCIAL_REQUEST_URL,
    }),
  });
}

// 5-step nurture. The social-lead-nurture cron supplies the step; idempotency
// is keyed on email + step so each step in the sequence sends exactly once.
export async function sendSocialLeadNurtureEmail(params: {
  to: string;
  firstName: string;
  step: number;
  vehicleInterest?: string;
  city?: string;
}): Promise<EmailSendOutcome> {
  const { to, firstName, step, vehicleInterest, city } = params;

  let subject: string;
  let heading: string;
  let bodyHtml: string;
  let ctaLabel: string;
  let ctaUrl: string;

  switch (step) {
    case 1:
      subject = `How AutoLenis works, ${firstName}`;
      heading = "Dealers compete. You choose.";
      bodyHtml = `
        <p>Hi ${firstName},</p>
        <p>Buying a car with AutoLenis is a reverse auction — instead of you chasing dealers, dealers compete for you. Here's all there is to it:</p>
        <ul style="margin:8px 0 16px;padding-left:20px;color:#4B5563;line-height:1.9">
          <li><strong>Submit your request</strong> — tell us the vehicle you want.</li>
          <li><strong>Dealers compete</strong> — qualified local dealers send private offers.</li>
          <li><strong>You choose</strong> — compare side by side and pick the best price.</li>
        </ul>
        <p>No haggling. No showroom visits. No pressure.</p>
      `;
      ctaLabel = "See How It Works";
      ctaUrl = SOCIAL_HOW_IT_WORKS_URL;
      break;
    case 2:
      subject = `Dealers in ${city || "your area"} are ready`;
      heading = "Your request is still active";
      bodyHtml = `
        <p>Hi ${firstName},</p>
        <p>Dealers on our platform are actively looking for buyers right now. Your request is still active and ready to be matched with competing offers in ${city || "your area"}.</p>
        <p>It only takes a moment to activate — and there's never any obligation to accept an offer.</p>
      `;
      ctaLabel = "Activate My Auction";
      ctaUrl = SOCIAL_REQUEST_URL;
      break;
    case 3:
      subject = `Real results from AutoLenis buyers`;
      heading = "Multiple offers, completely free to start";
      bodyHtml = `
        <p>Hi ${firstName},</p>
        <p>AutoLenis buyers consistently receive multiple competing offers within 48 hours. The process is completely free to start — you only pay the $99 Auction Access Fee when you're ready to activate your private auction.</p>
        <p>That one-time fee is what puts local dealers in real competition for your business.</p>
      `;
      ctaLabel = "Get My Competing Offers";
      ctaUrl = SOCIAL_REQUEST_URL;
      break;
    case 4:
      subject = `Still looking for ${vehicleInterest || "your vehicle"}?`;
      heading = "Pick up where you left off";
      bodyHtml = `
        <p>Hi ${firstName},</p>
        <p>Your request is still saved. Pick up where you left off — dealers in your area are waiting to compete for ${vehicleInterest || "your next vehicle"}.</p>
      `;
      ctaLabel = "Continue My Request";
      ctaUrl = SOCIAL_REQUEST_URL;
      break;
    case 5:
    default:
      subject = `Last chance — your dealer request`;
      heading = "Your free auction is ready";
      bodyHtml = `
        <p>Hi ${firstName},</p>
        <p>We want to make sure you get the best price on your next vehicle. If you're still in the market, your free auction is ready to activate.</p>
        <p>This is our final follow-up — no pressure either way.</p>
      `;
      ctaLabel = "Claim My Free Auction";
      ctaUrl = SOCIAL_REQUEST_URL;
      break;
  }

  return sendIdempotent({
    idempotencyKey: `social-nurture-${to}-step${step}`.toLowerCase(),
    to,
    templateId: `social-lead-nurture-step-${step}`,
    subject,
    html: renderSocialEmail({ to, heading, bodyHtml, ctaLabel, ctaUrl }),
  });
}
