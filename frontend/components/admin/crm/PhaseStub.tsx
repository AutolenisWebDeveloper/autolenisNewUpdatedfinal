import type { LucideIcon } from 'lucide-react';

export function PhaseStub({
  icon: Icon,
  title,
  phase,
  description,
}: {
  icon: LucideIcon;
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <Icon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-2">{description}</p>
        <div className="mt-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-500/10 border border-blue-500/30 rounded-full px-3 py-1">
          Coming in {phase}
        </div>
      </div>
    </div>
  );
}
