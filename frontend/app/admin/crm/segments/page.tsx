import { Filter } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function SegmentsStubPage() {
  return (
    <PhaseStub
      icon={Filter}
      title="Segments"
      phase="Phase 3"
      description="Dynamic audience builder with condition-based contact filtering and live count preview."
    />
  );
}
