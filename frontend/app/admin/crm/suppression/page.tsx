import { ShieldOff } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function SuppressionStubPage() {
  return (
    <PhaseStub
      icon={ShieldOff}
      title="Suppression"
      phase="Phase 3"
      description="Email and SMS suppression list manager — CAN-SPAM and TCPA compliance surface."
    />
  );
}
