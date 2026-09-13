// lib/services/comms/__tests__/direct-send-allowlist.ts
//
// THE PHASE 2 LEGACY ALLOWLIST. §8.4 row: "Direct Resend/Twilio sends in
// transaction code — neutralised in Phase 2 (allowlist) → Phase 10 (zero);
// remove wrappers when the allowlist is empty."
//
// Every file below reaches a communication provider WITHOUT going through the §27
// dispatcher. That is the state of the tree on the day Phase 2 landed, enumerated
// from it rather than transcribed, and it is the number that has to reach zero.
// `no-direct-transactional-send.test.ts` fails on any file NOT listed here, and
// equally on any entry here that no longer sends — a stale entry silently widens
// the rule, which is how an allowlist stops being a ledger and becomes a loophole.
//
// `reasons` says HOW each file reaches a provider:
//   • `resend-sdk` / `twilio-sdk` — imports the vendor SDK directly;
//   • `direct-sender` — calls a `resend.service` export that lands on
//     `sendIdempotent` rather than on `enqueueTransactionalEmail`. That
//     classification is DERIVED AT TEST TIME from resend.service's own source, not
//     hardcoded, so migrating one export to the dispatcher reclassifies every
//     caller automatically and this list shrinks by itself;
//   • `sms` — calls a `sendSms` / `sendCrmSms` entry point.
//
// `removalPhase` is 10 for every entry, per §8.4. Phase 2 does not delete these —
// it makes the count visible and stops it growing. Each is additionally wrapped by
// the `LEGACY_PATH_WRITE` adapter so the removal counter starts here, on evidence
// rather than on inspection.
//
// NOT AN ALLOWLIST ENTRY, and never will be: `lib/services/comms/comms-providers.ts`
// is the dispatcher's own adapter — the one place the §27 rail is SUPPOSED to touch
// a provider — and `lib/services/email/resend.service.ts` is the legacy rail itself.
// Both are listed because they import the SDK, which is what they are for.

export interface DirectSendAllowlistEntry {
  /** Repo-relative path, from the `frontend/` root. */
  readonly file: string;
  /** How this file reaches a provider. */
  readonly reasons: readonly ("resend-sdk" | "twilio-sdk" | "direct-sender" | "sms")[];
  /** The `resend.service` direct-rail exports it calls, if any. */
  readonly senders: readonly string[];
  /** The phase that removes this path. §8.4: 10. */
  readonly removalPhase: number;
}

export const DIRECT_SEND_ALLOWLIST: readonly DirectSendAllowlistEntry[] = [
  { file: "app/api/admin/admins/route.ts", reasons: ["direct-sender"], senders: ["sendCustomAdminEmail"], removalPhase: 10 },
  { file: "app/api/admin/affiliates/[affiliateId]/approve/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateActivationEmail"], removalPhase: 10 },
  { file: "app/api/admin/affiliates/[affiliateId]/reactivate/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateReinstatedEmail"], removalPhase: 10 },
  { file: "app/api/admin/affiliates/[affiliateId]/reject/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateRejectionEmail"], removalPhase: 10 },
  { file: "app/api/admin/affiliates/[affiliateId]/suspend/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateSuspendedEmail"], removalPhase: 10 },
  { file: "app/api/admin/auctions/[auctionId]/action/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAuctionInvitationEmail"], removalPhase: 10 },
  { file: "app/api/admin/auth/setup-mfa/send-email/route.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/deposit/override/route.ts", reasons: ["direct-sender"], senders: ["sendDepositConfirmationEmail"], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/invite/route.ts", reasons: ["direct-sender"], senders: ["sendAdminCreatedBuyerEmail"], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/invite-outside-dealers/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAuctionInvitationEmail"], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/launch-auction/route.ts", reasons: ["direct-sender"], senders: ["sendAuctionActivatedEmail", "sendDealerAuctionInvitationEmail"], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/prequal/manual-override/route.ts", reasons: ["direct-sender"], senders: ["sendAdverseActionEmail", "sendPrequalApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/buyers/[buyerId]/prequal/resend-email/route.ts", reasons: ["direct-sender"], senders: ["sendAdverseActionEmail", "sendPrequalApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/comms/send-email/route.ts", reasons: ["direct-sender"], senders: ["sendCustomAdminEmail"], removalPhase: 10 },
  { file: "app/api/admin/compliance/ofac/[prequalId]/route.ts", reasons: ["direct-sender"], senders: ["sendPrequalApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/contract-shield/[reviewId]/route.ts", reasons: ["direct-sender"], senders: ["sendContractApprovedEmail", "sendContractShieldAlertEmail", "sendDealerContractIssuesEmail"], removalPhase: 10 },
  { file: "app/api/admin/crm/conversations/[id]/reply/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/admin/dealer-outreach/compose/route.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/admin/dealers/[dealerId]/approve/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAccountApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/[dealerId]/compliance/flag/route.ts", reasons: ["direct-sender"], senders: ["sendDealerComplianceNoticeEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/[dealerId]/reactivate/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAccountReinstatedEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/[dealerId]/suspend/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAccountSuspendedEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/[dealerId]/terminate/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAccountTerminatedEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/applications/[appId]/approve/route.ts", reasons: ["direct-sender"], senders: ["sendDealerApplicationApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/applications/[appId]/reject/route.ts", reasons: ["direct-sender"], senders: ["sendDealerApplicationRejectedEmail", "sendDealerRejectionEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/invitations/[invId]/resend/route.ts", reasons: ["direct-sender"], senders: ["sendDealerInvitationEmail"], removalPhase: 10 },
  { file: "app/api/admin/dealers/invite/route.ts", reasons: ["direct-sender"], senders: ["sendDealerInvitationEmail"], removalPhase: 10 },
  { file: "app/api/admin/deals/[dealId]/action/route.ts", reasons: ["direct-sender"], senders: ["sendDealCompleteEmail", "sendDealerContractIssuesEmail", "sendDealerContractPendingEmail"], removalPhase: 10 },
  { file: "app/api/admin/deals/[dealId]/esign/route.ts", reasons: ["direct-sender"], senders: ["sendDealerEsignInitiatedEmail"], removalPhase: 10 },
  { file: "app/api/admin/deals/[dealId]/pickup/complete/route.ts", reasons: ["direct-sender"], senders: ["sendDealCompleteEmail", "sendDealerPayoutInitiatedEmail", "sendDealerPickupCompletedEmail"], removalPhase: 10 },
  { file: "app/api/admin/deals/[dealId]/pickup/schedule/route.ts", reasons: ["direct-sender"], senders: ["sendDealerPickupScheduledEmail", "sendPickupReadyEmail"], removalPhase: 10 },
  { file: "app/api/admin/external-preapprovals/[id]/approve/route.ts", reasons: ["direct-sender"], senders: ["sendPrequalApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/payments/concierge-fee/send-link/route.ts", reasons: ["direct-sender"], senders: ["sendConciergeFeePaymentLinkEmail"], removalPhase: 10 },
  { file: "app/api/admin/payments/deposit/send-link/route.ts", reasons: ["direct-sender"], senders: ["sendDepositPaymentLinkEmail"], removalPhase: 10 },
  { file: "app/api/admin/prequal/[id]/decide/route.ts", reasons: ["direct-sender"], senders: ["sendAdverseActionEmail", "sendPrequalApprovedEmail"], removalPhase: 10 },
  { file: "app/api/admin/users/create/route.ts", reasons: ["direct-sender"], senders: ["sendAdminCreatedAffiliateEmail", "sendAdminCreatedBuyerEmail", "sendAdminCreatedDealerEmail"], removalPhase: 10 },
  { file: "app/api/admin/vehicle-offers/[id]/send-to-buyer/route.ts", reasons: ["direct-sender"], senders: ["sendVehicleOfferReady"], removalPhase: 10 },
  { file: "app/api/affiliate/register/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateVerificationEmail"], removalPhase: 10 },
  { file: "app/api/auth/resend-verification/route.ts", reasons: ["direct-sender"], senders: ["sendAffiliateVerificationEmail", "sendWelcomeEmail"], removalPhase: 10 },
  { file: "app/api/crm/dispatch/email/route.ts", reasons: ["direct-sender"], senders: ["sendCrmDispatchEmail"], removalPhase: 10 },
  { file: "app/api/crm/dispatch/sms/route.ts", reasons: ["sms"], senders: [], removalPhase: 10 },
  { file: "app/api/cron/amips-digest/route.ts", reasons: ["direct-sender"], senders: ["sendCustomAdminEmail"], removalPhase: 10 },
  { file: "app/api/cron/auction-close/route.ts", reasons: ["direct-sender"], senders: ["sendDealerAuctionReminderEmail", "sendDealerOfferRevisionClosingEmail"], removalPhase: 10 },
  // DELISTED IN PHASE 5 (S7-20). The 50%/90% invitation reminders now go through
  // `sweepInvitationReminders` → `enqueueTransactional`, keyed per INVITATION rather than per
  // auction. The direct rail applied no suppression, so a dealership that bounced or used its
  // own one-click unsubscribe was re-emailed on every sweep — and the route's previous key
  // collided across rails, so one auction could emit at most one reminder no matter how many
  // rooftops were invited. Delisted ahead of the §8.4 Phase 10 clock because Phase 5 owns this
  // cron and the rule is that every communication goes through the dispatcher.
  { file: "app/api/cron/dealer-scorecard-snapshot/route.ts", reasons: ["direct-sender"], senders: ["sendDealerWeeklyScorecardEmail"], removalPhase: 10 },
  // DELISTED IN PHASE 4 (jobs/I-22). The stale sweep's two dealer notices —
  // sendDealerStaleListingRemovalEmail and sendDealerInventorySyncFailureEmail — now go
  // through enqueueTransactional. They were the last direct sends on a SCHEDULED path,
  // and the direct rail applies no suppression, so a dealer who bounced or unsubscribed
  // was re-emailed on every sweep, nightly. Ahead of the §8.4 Phase 10 clock because
  // Phase 4 owns the cron (jobs/I-22) and the rule is that a query failure and a send
  // both go through the substrate.
  { file: "app/api/cron/social-lead-nurture/route.ts", reasons: ["direct-sender"], senders: ["sendSocialLeadNurtureEmail"], removalPhase: 10 },
  { file: "app/api/cron/social-optimize/route.ts", reasons: ["direct-sender"], senders: ["sendOptimizationReport"], removalPhase: 10 },
  { file: "app/api/dealer/auth/forgot-password/route.ts", reasons: ["direct-sender"], senders: ["sendDealerPasswordResetEmail"], removalPhase: 10 },
  { file: "app/api/dealer/invite/claim/route.ts", reasons: ["direct-sender"], senders: ["sendDealerWelcomeEmail"], removalPhase: 10 },
  { file: "app/api/dealer/offers/[offerId]/revise/route.ts", reasons: ["direct-sender"], senders: ["sendDealerOfferSubmittedEmail"], removalPhase: 10 },
  { file: "app/api/dealer/offers/route.ts", reasons: ["direct-sender"], senders: ["sendDealerOfferSubmittedEmail"], removalPhase: 10 },
  { file: "app/api/dealer/pickup/scan/route.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/leads/lead-magnet/route.ts", reasons: ["direct-sender"], senders: ["sendLeadMagnetDeliveryEmail"], removalPhase: 10 },
  { file: "app/api/public/contact/route.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/public/dealer-application/route.ts", reasons: ["direct-sender"], senders: ["sendDealerApplicationAdminNotification", "sendDealerApplicationReceived", "sendDealerApplicationReceivedEmail"], removalPhase: 10 },
  { file: "app/api/public/feedback/route.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/public/request-vehicle/route.ts", reasons: ["direct-sender"], senders: ["sendSocialLeadWelcomeEmail", "sendVehicleRequestReceived"], removalPhase: 10 },
  { file: "app/api/tools/dealer-fee-lead/route.ts", reasons: ["direct-sender"], senders: ["sendDealerFeeCalculatorWelcomeEmail"], removalPhase: 10 },
  { file: "app/api/twilio/voice/fallback/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/twilio/voice/incoming/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/twilio/voice/process/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/twilio/voice/recording-complete/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/twilio/voice/transfer-status/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/api/webhooks/stripe/route.ts", reasons: ["direct-sender"], senders: ["sendAuctionActivatedEmail", "sendConciergeFeeConfirmationEmail", "sendDepositConfirmationEmail", "sendRefundConfirmationEmail"], removalPhase: 10 },
  { file: "app/api/webhooks/twilio/inbound/route.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "app/auth/callback/route.ts", reasons: ["direct-sender"], senders: ["sendEmailVerifiedEmail"], removalPhase: 10 },
  { file: "lib/auth/actions.ts", reasons: ["direct-sender"], senders: ["sendPasswordResetEmail", "sendWelcomeEmail"], removalPhase: 10 },
  { file: "lib/qstash/notify.ts", reasons: ["resend-sdk", "twilio-sdk", "sms"], senders: [], removalPhase: 10 },
  // DELISTED IN PHASE 5 (§13-D44, RETIRE OUTRIGHT). `notifyActiveDealersOfOpportunity` emailed
  // the first twenty ACTIVE dealers with no radius and no invitation, from the public request
  // route. It is now a stub that assembles no dealer pool at all, so there is no send to
  // allowlist — and a stale entry here would be a hole: the next direct send added to that file
  // would pass unnoticed.
  { file: "lib/services/acquisition/intake-pipeline.service.ts", reasons: ["direct-sender"], senders: ["sendBuyerOpportunityConfirmationEmail", "sendFounderHotLeadAlertEmail"], removalPhase: 10 },
  { file: "lib/services/acquisition/twilio.service.ts", reasons: ["twilio-sdk", "sms"], senders: [], removalPhase: 10 },
  { file: "lib/services/affiliate/digest.service.ts", reasons: ["direct-sender"], senders: ["sendAffiliateWeeklyDigest"], removalPhase: 10 },
  { file: "lib/services/auction/dealer-invitation.service.ts", reasons: ["direct-sender"], senders: ["sendDealerAuctionInvitationEmail"], removalPhase: 10 },
  { file: "lib/services/comms/comms-providers.ts", reasons: ["resend-sdk", "twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/contract-shield/contract-shield.service.ts", reasons: ["direct-sender"], senders: ["sendContractApprovedEmail", "sendContractShieldAlertEmail"], removalPhase: 10 },
  { file: "lib/services/dealer-recruitment/dealer-email-send.service.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/email/buyer-notifications.service.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/email/dealer-agreement-confirmation.service.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/email/resend.service.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/email/vehicle-offers.email.ts", reasons: ["resend-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/services/esign/buyer-signing.service.ts", reasons: ["direct-sender"], senders: ["sendContractSignedEmail"], removalPhase: 10 },
  { file: "lib/services/notifications/acquisition-comms.ts", reasons: ["sms"], senders: [], removalPhase: 10 },
  { file: "lib/services/prequal/admin-prequal.service.ts", reasons: ["direct-sender"], senders: ["sendAdminPrequalAlertEmail", "sendAdverseActionEmail", "sendPrequalApprovedEmail", "sendPrequalUnderReviewEmail"], removalPhase: 10 },
  { file: "lib/services/prequal/prequal.service.ts", reasons: ["direct-sender"], senders: ["sendAdminPrequalAlertEmail", "sendAdverseActionEmail", "sendPrequalApprovedEmail", "sendPrequalUnderReviewEmail"], removalPhase: 10 },
  { file: "lib/services/sms/crm-sms.ts", reasons: ["twilio-sdk", "sms"], senders: [], removalPhase: 10 },
  { file: "lib/services/sms/twilio.service.ts", reasons: ["twilio-sdk", "sms"], senders: [], removalPhase: 10 },
  { file: "lib/social/creator-package.generator.ts", reasons: ["direct-sender"], senders: ["sendCreatorPackageEmail"], removalPhase: 10 },
  { file: "lib/social/market-index.generator.ts", reasons: ["direct-sender"], senders: ["sendMarketIndexPublishedEmail"], removalPhase: 10 },
  { file: "lib/social/sms-distribution.service.ts", reasons: ["sms"], senders: [], removalPhase: 10 },
  { file: "lib/voice/call-transfer.service.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/voice/dispatch-request.ts", reasons: ["twilio-sdk", "direct-sender"], senders: ["sendAdminCreatedBuyerEmail"], removalPhase: 10 },
  { file: "lib/voice/handle-turn.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/voice/transactional-sms.ts", reasons: ["sms"], senders: [], removalPhase: 10 },
  { file: "lib/voice/twilio-verify.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "lib/voice/voice-input.ts", reasons: ["twilio-sdk"], senders: [], removalPhase: 10 },
  { file: "scripts/test-buyer-signup.ts", reasons: ["direct-sender"], senders: ["sendWelcomeEmail"], removalPhase: 10 },
  { file: "scripts/verify-prequal-remediation.ts", reasons: ["resend-sdk", "direct-sender"], senders: ["sendAdverseActionEmail", "sendPrequalApprovedEmail", "sendPrequalUnderReviewEmail"], removalPhase: 10 },
];
