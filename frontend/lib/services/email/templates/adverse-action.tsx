// lib/services/email/templates/adverse-action.tsx
// FCRA Section 615 adverse action notice — sent to buyers whose
// AutoLenis prequalification was DECLINED based on a consumer report.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const ADVERSE_ACTION_SUBJECT =
  "Important Notice Regarding Your AutoLenis Prequalification";

export interface AdverseActionEmailProps {
  firstName: string;
  decisionDate: string;
  /** Optional principal-reason codes from the consumer report (FCRA § 615(a)).
   *  Supplemental detail — the required FCRA notice language is unchanged. */
  reasonCodes?: string[];
}

export function renderAdverseActionEmail(props: AdverseActionEmailProps): string {
  const { firstName, decisionDate, reasonCodes } = props;

  // Supplemental principal-reasons block — rendered only when codes are present.
  // Does NOT replace or alter any required FCRA § 615 language below.
  const reasonsBlock =
    reasonCodes && reasonCodes.length > 0
      ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
                <tr>
                  <td style="background:#f9f9f9;border:1px solid #e0e0e0;padding:16px 20px;border-radius:4px;">
                    <p style="margin:0 0 8px 0;font-weight:bold;color:#333333;font-size:14px;">Principal reason(s) for this decision</p>
                    <p style="margin:0;color:#555555;font-size:14px;">${reasonCodes
                      .map((c) => String(c).replace(/[<>&]/g, ""))
                      .join(", ")}</p>
                  </td>
                </tr>
              </table>
`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Important Notice Regarding Your AutoLenis Prequalification</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#0B5FD1;padding:32px;text-align:center;">
              <p style="color:#ffffff;font-size:22px;font-weight:bold;margin:0;">AutoLenis</p>
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Important Notice</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p>Dear ${firstName},</p>
              <p>Thank you for applying for prequalification with AutoLenis.</p>
              <p>After reviewing the information obtained in connection with your request, we are unable to offer you prequalification at this time.</p>
              <p>This decision was based in whole or in part on information obtained from the following consumer reporting agency:</p>
              <!-- CRA Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
                <tr>
                  <td style="background:#F8F9FB;border-left:4px solid #0B5FD1;padding:16px 20px;border-radius:4px;">
                    <p style="margin:0;font-weight:bold;color:#333333;">MicroBilt Corporation</p>
                    <p style="margin:4px 0 0 0;color:#555555;">1640 Airport Rd., Suite 115</p>
                    <p style="margin:4px 0 0 0;color:#555555;">Kennesaw, GA 30144</p>
                    <p style="margin:4px 0 0 0;color:#555555;">Phone: 1-800-884-4747</p>
                  </td>
                </tr>
              </table>
              <p>The consumer reporting agency listed above did not make this decision and is unable to provide you with the specific reasons why prequalification was not offered.</p>
${reasonsBlock}              <!-- Rights Section -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="background:#f9f9f9;border:1px solid #e0e0e0;padding:20px 24px;border-radius:4px;">
                    <p style="margin:0 0 12px 0;font-weight:bold;color:#333333;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Your Rights Under the Fair Credit Reporting Act</p>
                    <p style="margin:0 0 10px 0;color:#555555;font-size:14px;">You have the right to obtain a free copy of your consumer report from MicroBilt Corporation within <strong>60 days</strong> of receiving this notice by contacting them at the address or phone number above.</p>
                    <p style="margin:0;color:#555555;font-size:14px;">You have the right to dispute the accuracy or completeness of any information in your consumer report directly with MicroBilt Corporation.</p>
                  </td>
                </tr>
              </table>
              <p style="font-size:13px;color:#888888;">This notice was sent on ${decisionDate} in compliance with the Fair Credit Reporting Act, 15 U.S.C. § 1681 et seq.</p>
              <p style="font-size:13px;color:#888888;">If you have questions, please contact us at <a href="mailto:support@autolenis.com" style="color:#0B5FD1;">support@autolenis.com</a>.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#F8F9FB;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis, Inc.</p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;">This is a required legal notice under the Fair Credit Reporting Act.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
