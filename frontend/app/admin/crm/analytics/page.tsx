import { BarChart3 } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function AnalyticsStubPage() {
  return (
    <PhaseStub
      icon={BarChart3}
      title="Analytics"
      phase="Phase 5"
      description="Funnel, campaign, automation, dealer, affiliate, revenue, and reputation dashboards."
    />
  );
}
