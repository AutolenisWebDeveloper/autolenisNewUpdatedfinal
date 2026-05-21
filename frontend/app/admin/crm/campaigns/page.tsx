import { Send } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function CampaignsStubPage() {
  return (
    <PhaseStub
      icon={Send}
      title="Campaigns"
      phase="Phase 3"
      description="Multi-channel campaign builder with segmentation, scheduling, and Inngest fan-out."
    />
  );
}
