// lib/affiliate/disclosures.ts — the single source of truth for the FTC
// disclosure set an affiliate must acknowledge (M-19).
//
// Shared by the compliance UI (renders these) and the acknowledge API
// (validates the submitted set covers every required id, and records exactly
// which disclosures were shown and checked). Changing this list — text or
// membership — REQUIRES bumping AFFILIATE_DISCLOSURE_VERSION in lib/constants
// so prior acknowledgments are re-collected against the new content.

export const AFFILIATE_DISCLOSURES = [
  {
    id: "ftc-material",
    title: "FTC Material Connection Disclosure",
    text: "You must disclose your relationship with AutoLenis when promoting the platform. This includes any blogs, social media posts, videos, or other content where you mention or recommend AutoLenis in exchange for compensation.",
    required: true,
  },
  {
    id: "earnings-claims",
    title: "No Guaranteed Earnings Claims",
    text: "You may not make guarantees about earnings potential when promoting the AutoLenis affiliate program. You may share your own results accurately, but must note that results vary.",
    required: true,
  },
  {
    id: "tcpa-compliance",
    title: "TCPA Compliance",
    text: "You may not send unsolicited text messages or use auto-dialers to promote AutoLenis. All communications must comply with the Telephone Consumer Protection Act.",
    required: true,
  },
  {
    id: "spam-prohibition",
    title: "Anti-Spam Policy",
    text: "You may not use spam, deceptive email subject lines, purchased email lists, or any unsolicited bulk messaging to promote your referral link.",
    required: true,
  },
  {
    id: "platform-accuracy",
    title: "Accurate Platform Representation",
    text: "You must accurately represent AutoLenis features and pricing. You may not claim the $99 deposit is non-refundable or misrepresent the $499 concierge fee structure.",
    required: true,
  },
] as const;

export const REQUIRED_DISCLOSURE_IDS: readonly string[] = AFFILIATE_DISCLOSURES
  .filter((d) => d.required)
  .map((d) => d.id);
