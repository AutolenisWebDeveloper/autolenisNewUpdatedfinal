// Email template: Prequalification Under Review
//
// Sent to a buyer when their prequal resolves to MANUAL_REVIEW / OFAC_REVIEW /
// OFAC_ESCALATED. OFAC-SILENT: this email must never reveal the cause of the
// review (OFAC / sanctions / specific data) — to the buyer it is simply
// "we're taking a closer look".

export const PREQUAL_UNDER_REVIEW_SUBJECT =
  "We're reviewing your AutoLenis pre-qualification";

export interface PrequalUnderReviewTemplateProps {
  firstName: string;
}

export function renderPrequalUnderReviewEmail({
  firstName,
}: PrequalUnderReviewTemplateProps): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:#0B5FD1;padding:28px 32px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">We're reviewing your application</h1>
      </div>
      <div style="padding:28px 32px;color:#111827;line-height:1.55">
        <p style="margin-top:0">Hi ${firstName},</p>
        <p>
          Thanks for submitting your AutoLenis pre-qualification. Your application is
          taking a closer look by our team before we can finalize a decision.
        </p>
        <p>
          We expect to have an update for you within <strong>1&ndash;2 business days</strong>.
          You don't need to do anything in the meantime &mdash; we'll email you as soon as
          there's news, and you can also check your status anytime in the AutoLenis portal.
        </p>
        <p style="margin-bottom:0">
          If you have questions, reply to this email or reach us at
          <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none">support@autolenis.com</a>.
        </p>
      </div>
      <div style="padding:18px 32px;background:#F8F9FB;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:center">
        AutoLenis &middot; This is an automated message. Please do not include sensitive personal information in your reply.
      </div>
    </div>
  `.trim();
}
