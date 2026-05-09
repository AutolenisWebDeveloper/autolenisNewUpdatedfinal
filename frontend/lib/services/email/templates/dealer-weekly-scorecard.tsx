// lib/services/email/templates/dealer-weekly-scorecard.tsx
// Dealer Weekly Scorecard — sent weekly with performance metrics.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_WEEKLY_SCORECARD_SUBJECT =
  "Your Weekly Dealer Scorecard — AutoLenis";

export interface DealerWeeklyScorecardEmailProps {
  contactName: string;
  dealershipName: string;
  winRate: number;
  avgResponseTimeHours: number;
  offersSubmitted: number;
  currentTier: string;
  scorecardUrl: string;
}

export function renderDealerWeeklyScorecardEmail({
  contactName,
  dealershipName,
  winRate,
  avgResponseTimeHours,
  offersSubmitted,
  currentTier,
  scorecardUrl,
}: DealerWeeklyScorecardEmailProps): string {
  const winRatePct = `${(winRate * 100).toFixed(1)}%`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Dealer Scorecard — AutoLenis</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#0B5FD1;padding:32px;text-align:center;">
              <p style="color:#ffffff;font-size:26px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Weekly Dealer Scorecard</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 24px 0;">Here is your weekly performance summary for <strong>${dealershipName}</strong>.</p>
              <!-- Metrics -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border-collapse:collapse;">
                <tr>
                  <td style="width:50%;padding:16px;background:#F8F9FB;border:1px solid #F0F9FF;text-align:center;border-radius:6px 0 0 0;">
                    <p style="margin:0;font-size:13px;color:#0B5FD1;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Win Rate</p>
                    <p style="margin:8px 0 0 0;font-size:28px;font-weight:bold;color:#333333;">${winRatePct}</p>
                  </td>
                  <td style="width:50%;padding:16px;background:#F8F9FB;border:1px solid #F0F9FF;text-align:center;border-radius:0 6px 0 0;">
                    <p style="margin:0;font-size:13px;color:#0B5FD1;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Avg Response Time</p>
                    <p style="margin:8px 0 0 0;font-size:28px;font-weight:bold;color:#333333;">${avgResponseTimeHours}h</p>
                  </td>
                </tr>
                <tr>
                  <td style="width:50%;padding:16px;background:#ffffff;border:1px solid #F0F9FF;text-align:center;border-top:none;border-radius:0 0 0 6px;">
                    <p style="margin:0;font-size:13px;color:#0B5FD1;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Offers Submitted</p>
                    <p style="margin:8px 0 0 0;font-size:28px;font-weight:bold;color:#333333;">${offersSubmitted}</p>
                  </td>
                  <td style="width:50%;padding:16px;background:#ffffff;border:1px solid #F0F9FF;text-align:center;border-top:none;border-radius:0 0 6px 0;">
                    <p style="margin:0;font-size:13px;color:#0B5FD1;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Current Tier</p>
                    <p style="margin:8px 0 0 0;font-size:22px;font-weight:bold;color:#0B5FD1;">${currentTier}</p>
                  </td>
                </tr>
              </table>
              <!-- Tier Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 20px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Tier Progression</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr style="background:#F8F9FB;">
                        <td style="padding:8px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Standard</td>
                        <td style="padding:8px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Entry tier — access to all auctions</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Silver</td>
                        <td style="padding:8px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Priority auction placement + analytics</td>
                      </tr>
                      <tr style="background:#F8F9FB;">
                        <td style="padding:8px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Gold</td>
                        <td style="padding:8px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Dedicated account manager + premium placement</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 12px;font-size:13px;font-weight:bold;color:#0B5FD1;border:1px solid #F0F9FF;">Platinum</td>
                        <td style="padding:8px 12px;font-size:13px;color:#555555;border:1px solid #F0F9FF;">Custom SLA + full API access</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${scorecardUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      View Full Scorecard &#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:24px 40px;text-align:center;border-top:1px solid #F0F9FF;">
              <p style="margin:0;font-size:13px;color:#888888;">AutoLenis, Inc. &middot; <a href="mailto:support@autolenis.com" style="color:#0B5FD1;text-decoration:none;">support@autolenis.com</a></p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#aaaaaa;"><a href="#" style="color:#aaaaaa;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
