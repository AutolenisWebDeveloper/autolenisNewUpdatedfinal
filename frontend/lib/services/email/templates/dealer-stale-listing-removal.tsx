// lib/services/email/templates/dealer-stale-listing-removal.tsx
// Dealer Stale Listing Removal — sent when stale listings are removed from the platform.
// Uses plain HTML string — no react-dom/server import (not compatible with Next.js App Router).

export const DEALER_STALE_LISTING_REMOVAL_SUBJECT =
  "Stale Listings Removed — AutoLenis";

export interface DealerStaleListingRemovalEmailProps {
  contactName: string;
  affectedVehicles: Array<{ year: number; make: string; model: string }>;
  reason: string;
  inventoryUrl: string;
}

export function renderDealerStaleListingRemovalEmail({
  contactName,
  affectedVehicles,
  reason,
  inventoryUrl,
}: DealerStaleListingRemovalEmailProps): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stale Listings Removed — AutoLenis</title>
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
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Inventory Notice</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${contactName},</p>
              <p style="margin:0 0 16px 0;">The following listings have been removed from the AutoLenis platform because they were identified as stale.</p>
              <!-- Reason -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:12px 16px;background:#fff8e6;border:1px solid #f5e0a0;border-radius:6px;">
                    <p style="margin:0;font-size:14px;color:#555555;"><strong>Reason:</strong> ${reason}</p>
                  </td>
                </tr>
              </table>
              <!-- Affected Vehicles -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border:1px solid #F0F9FF;border-radius:6px;overflow:hidden;">
                <tr>
                  <td style="padding:12px 16px;background:#F8F9FB;border-bottom:1px solid #F0F9FF;">
                    <p style="margin:0;font-size:13px;font-weight:bold;color:#0B5FD1;text-transform:uppercase;letter-spacing:0.5px;">Removed Vehicles (${affectedVehicles.length})</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr style="background:#f0ecf8;">
                        <th style="padding:10px 16px;font-size:13px;color:#0B5FD1;text-align:left;border-bottom:1px solid #F0F9FF;">Year</th>
                        <th style="padding:10px 16px;font-size:13px;color:#0B5FD1;text-align:left;border-bottom:1px solid #F0F9FF;">Make</th>
                        <th style="padding:10px 16px;font-size:13px;color:#0B5FD1;text-align:left;border-bottom:1px solid #F0F9FF;">Model</th>
                      </tr>
                      ${affectedVehicles.map((v) => `<tr>
                        <td style="padding:10px 16px;font-size:14px;color:#333333;border-bottom:1px solid #f5f5f5;">${v.year}</td>
                        <td style="padding:10px 16px;font-size:14px;color:#333333;border-bottom:1px solid #f5f5f5;">${v.make}</td>
                        <td style="padding:10px 16px;font-size:14px;color:#333333;border-bottom:1px solid #f5f5f5;">${v.model}</td>
                      </tr>`).join("")}
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:14px;color:#555555;">To re-list these vehicles or update your inventory, visit your inventory management page.</p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${inventoryUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Manage Inventory &#8594;
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
