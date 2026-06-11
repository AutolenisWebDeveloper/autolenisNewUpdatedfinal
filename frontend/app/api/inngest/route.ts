import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { contentFunctions } from '@/lib/inngest/content-functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Existing messaging/automation workers + the new content-ops workers.
  functions: [...inngestFunctions, ...contentFunctions],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
