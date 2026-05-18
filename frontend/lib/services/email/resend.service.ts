// lib/services/email/resend.service.ts
// Transactional email via Resend — ONLY approved email provider
// All sends are idempotent — check EmailSendLog before every send
// FROM_NAME and RESEND_API_KEY from env

import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
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
    console.error("[EMAIL] EmailSendLog check failed — proceeding with send:", err);
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
      console.warn(
        `[EMAIL] RESEND_API_KEY not set or is placeholder — email skipped. To: ${params.to}`,
      );
      status = "DEV_SKIPPED";
    } else {
      const resend = getResend();
      if (!resend) {
        console.error("[EMAIL] Resend client could not be initialized despite API key being set");
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
          console.error(
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
    console.error(`Email send failed: ${err}`);
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
    console.warn(
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
          <p style="color:#4B5563;font-size:13px">Commission rates on the $499 Premium concierge fee: L1 15% &middot; L2 3% &middot; L3 2%.</p>
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
              <li>When they complete a deal, you earn <strong>15% of the $499 concierge fee ($74.85)</strong>.</li>
              <li>Their referrals earn you L2 (3%) and L3 (2%) commissions — up to 3 levels deep.</li>
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
