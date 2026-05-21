import { FileText } from 'lucide-react';
import { PhaseStub } from '@/components/admin/crm/PhaseStub';

export default function TemplatesStubPage() {
  return (
    <PhaseStub
      icon={FileText}
      title="Templates"
      phase="Phase 3"
      description="Versioned email templates with variable substitution and CAN-SPAM footer enforcement."
    />
  );
}
