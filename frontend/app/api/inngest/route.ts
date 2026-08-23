import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';
import { intakeFunctions } from '@/lib/inngest/intake-functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Remaining Inngest workers during the incremental retirement:
  //   - inngestFunctions: the campaign fan-out + scheduled-campaign cron + the two
  //     LP lead-nurture workers (formAbandonment / exitIntent). Their per-recipient
  //     sends already enqueue to the internal comms outbox; their triggers are the
  //     last workloads pending migration (#4/#5/#10/#11).
  //   - intakeFunctions: dormant buyer-intake compatibility sink (no live emitter).
  // Migrated off Inngest and removed: analytics/inactivity/saved-search crons
  // (Batch 3), content generation (Batch 4), workflow.resume (Batch 5), email/sms
  // (Batch 6), and dealer.award (Batch 7 → dealer-award-dispatch cron).
  functions: [
    ...inngestFunctions,
    ...intakeFunctions,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
