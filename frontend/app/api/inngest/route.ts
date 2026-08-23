import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { intakeFunctions } from '@/lib/inngest/intake-functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Inngest workload retirement is COMPLETE — `inngestFunctions` is now empty
  // (every worker migrated onto the internal Vercel-Cron substrate; see
  // lib/inngest/functions.ts and docs/inngest-migration-ledger.md). The only
  // entry still served is `intakeFunctions`: a dormant buyer-intake
  // compatibility sink with NO live emitter, kept until the FINAL-REMOVAL
  // checklist is executed under owner gating.
  functions: [
    ...inngestFunctions,
    ...intakeFunctions,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
