import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { contentFunctions } from '@/lib/inngest/content-functions';
import { intakeFunctions } from '@/lib/inngest/intake-functions';
import { dealerAwardFunctions } from '@/lib/inngest/dealer-award-functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Existing messaging/automation workers + content-ops workers + the durable
  // buyer-intake orchestration worker (S1) + the dealer-award dispatch worker (S3).
  functions: [
    ...inngestFunctions,
    ...contentFunctions,
    ...intakeFunctions,
    ...dealerAwardFunctions,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
