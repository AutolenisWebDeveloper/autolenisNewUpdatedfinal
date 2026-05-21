import { Zap } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function AutomationsStubPage() {
  return (
    <PhaseStub
      icon={Zap}
      title="Automations"
      phase="Phase 4"
      description="Visual workflow builder powered by React Flow — triggers, conditions, delays, actions."
    />
  );
}
