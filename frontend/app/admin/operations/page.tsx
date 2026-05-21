import { Activity } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function OperationsStubPage() {
  return (
    <PhaseStub
      icon={Activity}
      title="Operations"
      phase="Phase 5"
      description="System health, dead letter queue, failed workflow enrollments, and admin audit log."
    />
  );
}
