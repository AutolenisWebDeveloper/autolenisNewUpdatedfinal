import { ShieldOff } from 'lucide-react';
import { Badge, EmptyState, PageHeader } from '@/components/admin/crm/ui';

export default function SuppressionPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6" data-testid="crm-suppression">
      <PageHeader
        title="Suppression"
        subtitle="Email and SMS suppression list — CAN-SPAM and TCPA compliance surface."
        data-testid="crm-suppression-header"
        actions={
          <Badge tone="trust" size="sm" data-testid="crm-suppression-phase">
            Coming in Phase 3
          </Badge>
        }
      />

      <div className="rounded-[var(--crm-radius-md)] border border-[var(--crm-trust-subtle)] crm-hairline bg-[var(--crm-bg-primary)]">
        <EmptyState
          icon={ShieldOff}
          variant="blocked"
          title="Suppression manager is on the way"
          description="This compliance surface will manage email and SMS opt-outs, bounces, complaints, and STOP requests — every suppression reason auditable against CAN-SPAM and TCPA."
          data-testid="crm-suppression-empty"
        />
      </div>
    </div>
  );
}
