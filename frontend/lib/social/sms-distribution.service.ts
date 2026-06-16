// AutoLenis Social Engine — SMS distribution.
//
// Consent-gated transactional SMS for the social funnel: weekly market alerts
// and live auction-update nudges. Built on the shared Twilio sender
// (lib/services/sms/twilio.service) — same lazy client, same TWILIO_FROM_NUMBER,
// same fire-and-forget error handling. Every body carries the required
// "Reply STOP" opt-out disclosure inline.

import { logger } from "@/lib/logger";
import { sendSms } from "@/lib/services/sms/twilio.service";

// SMS billing is per 160-char segment; warn (don't fail) past ~2 segments.
const MAX_SMS_CHARS = 320;

export async function sendMarketAlertSMS(input: {
  phoneNumber: string;
  firstName: string;
  make?: string;
  city?: string;
  marketSignal: string;
  trackedUrl?: string;
}): Promise<void> {
  let signal = input.marketSignal;
  // Truncate the signal first so the disclosure + link always survive.
  const overhead = `Hi ${input.firstName}! 📊 AutoLenis Alert: . ${
    input.trackedUrl ? `See options: ${input.trackedUrl}` : "autolenis.com/request-a-car"
  } Reply STOP to unsubscribe.`.length;
  const room = MAX_SMS_CHARS - overhead;
  if (room > 0 && signal.length > room) {
    signal = `${signal.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  }

  const message =
    `Hi ${input.firstName}! 📊 AutoLenis Alert: ` +
    `${signal}. ` +
    `${input.trackedUrl ? `See options: ${input.trackedUrl}` : "autolenis.com/request-a-car"}` +
    ` Reply STOP to unsubscribe.`;

  if (message.length > MAX_SMS_CHARS) {
    logger.warn("[sms] message too long — truncating");
  }

  await sendSms(input.phoneNumber, message);
}

export async function sendAuctionUpdateSMS(input: {
  phoneNumber: string;
  firstName: string;
  offerCount: number;
  hoursRemaining: number;
  auctionUrl: string;
}): Promise<void> {
  const message =
    `Hi ${input.firstName}! You have ${input.offerCount} dealer ` +
    `offer${input.offerCount !== 1 ? "s" : ""}. ` +
    `Auction closes in ${input.hoursRemaining}h. ` +
    `Compare: ${input.auctionUrl} | Reply STOP to opt out.`;

  await sendSms(input.phoneNumber, message);
}
