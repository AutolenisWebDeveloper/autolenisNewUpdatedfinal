// Phase C-Leads — lead magnet delivery email.
// Sent immediately when a buyer requests a free guide. Plain HTML string (no
// react-dom/server) to match the rest of the template layer. Segmented intro
// line by buyer timeline so the same template feels tailored across tracks.

export const LEAD_MAGNET_DELIVERY_SUBJECT = (magnetTitle: string) =>
  `Your free guide: ${magnetTitle}`;

export interface LeadMagnetDeliveryProps {
  firstName: string;
  magnetTitle: string;
  magnetDescription: string;
  bullets: string[];
  /** Absolute URL where the buyer reads the guide. */
  accessUrl: string;
  /** Absolute URL to start a dealer auction. */
  auctionUrl: string;
  /** Absolute unsubscribe URL. */
  unsubscribeUrl: string;
  /** One-line, timeline-specific opener. */
  segmentIntro: string;
}

export function renderLeadMagnetDeliveryEmail({
  firstName,
  magnetTitle,
  magnetDescription,
  bullets,
  accessUrl,
  auctionUrl,
  unsubscribeUrl,
  segmentIntro,
}: LeadMagnetDeliveryProps): string {
  const bulletHtml = bullets
    .map(
      (b) =>
        `<li style="margin:0 0 8px 0;color:#4B5563;font-size:14px;line-height:1.6;">${b}</li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${magnetTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background:#0B5FD1;padding:32px;text-align:center;">
              <p style="color:#ffffff;font-size:24px;font-weight:bold;margin:0;letter-spacing:-0.5px;">AutoLenis</p>
              <p style="color:#DBEAFE;font-size:14px;margin:8px 0 0 0;">Your free guide is ready</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 8px 40px;color:#333333;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 16px 0;">${segmentIntro}</p>
              <h2 style="margin:0 0 8px 0;font-size:20px;color:#0B5FD1;">${magnetTitle}</h2>
              <p style="margin:0 0 16px 0;color:#4B5563;">${magnetDescription}</p>
              <ul style="margin:0 0 24px 0;padding-left:20px;">${bulletHtml}</ul>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <a href="${accessUrl}"
                       style="display:inline-block;background:#0B5FD1;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;font-size:15px;">
                      Read the Guide &#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;padding-top:24px;">
                <tr>
                  <td style="color:#333333;font-size:14px;line-height:1.6;">
                    <p style="margin:0 0 8px 0;font-weight:bold;">Want to skip the negotiation entirely?</p>
                    <p style="margin:0 0 16px 0;color:#4B5563;">Let up to 8 local dealers compete for your business in a private 48-hour auction. You compare real out-the-door prices and pick the winner.</p>
                    <a href="${auctionUrl}" style="color:#0B5FD1;font-weight:bold;text-decoration:none;">Get dealers to compete &#8594;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#F8F9FB;padding:24px 40px;color:#94A3B8;font-size:12px;line-height:1.6;">
              <p style="margin:0 0 6px 0;">Written by Markist, Founder of AutoLenis.</p>
              <p style="margin:0;">You're receiving this because you requested a free guide from AutoLenis. <a href="${unsubscribeUrl}" style="color:#94A3B8;text-decoration:underline;">Unsubscribe</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
