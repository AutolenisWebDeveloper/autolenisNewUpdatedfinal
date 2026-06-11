import Link from 'next/link';
import { Workflow, ArrowRight } from 'lucide-react';
import { Button, PageHeader } from '@/components/admin/crm/ui';

export const dynamic = 'force-dynamic';

// The in-app Workflow builder has been retired — Make.com now owns automation.
// This route is left as a lightweight pointer to the Make scenarios monitor.
// The WorkflowBuilder / WorkflowList components and the flag-gated in-app engine
// (CRM_INAPP_ENGINE_ENABLED) remain in place for cutover; their removal is later.
export default function AutomationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="crm-automations">
      <PageHeader
        title="Workflows"
        subtitle="In-app automation has moved to Make.com."
        data-testid="crm-automations-header"
      />

      <section
        className="rounded-[var(--crm-radius-md)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-primary)] p-6"
        data-testid="crm-automations-pointer"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--crm-radius-md)] bg-[var(--crm-primary-subtle)] text-[var(--crm-primary)]">
            <Workflow className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-[var(--crm-text-primary)]">
              Automation now runs in Make
            </h2>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--crm-text-secondary)]">
              AutoLenis emits domain events and Make.com orchestrates them, calling back into{' '}
              <code className="rounded-[var(--crm-radius-sm)] border border-[var(--crm-border)] crm-hairline bg-[var(--crm-bg-secondary)] px-1 py-0.5 text-[12px] text-[var(--crm-text-secondary)]">
                /api/crm/dispatch/*
              </code>{' '}
              to act. Every send, consent check, and audit stays owned by AutoLenis. The legacy
              in-app builder is retired.
            </p>
            <div className="mt-4">
              <Link href="/admin/crm/scenarios" data-testid="crm-automations-view-scenarios">
                <Button variant="primary">
                  View scenarios <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
