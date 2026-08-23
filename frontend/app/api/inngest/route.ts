import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { intakeFunctions } from '@/lib/inngest/intake-functions';
import { dealerAwardFunctions } from '@/lib/inngest/dealer-award-functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Remaining Inngest workers during the incremental retirement:
  //   - inngestFunctions: messaging/campaign/workflow-resume/lead-nurture workers
  //   - intakeFunctions: dormant buyer-intake compatibility sink (no live emitter)
  //   - dealerAwardFunctions: dealer-award dispatch worker
  // Content generation (contentFunctions) was migrated to the internal
  // content-generation-drain cron and removed.
  functions: [
    ...inngestFunctions,
    ...intakeFunctions,
    ...dealerAwardFunctions,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
