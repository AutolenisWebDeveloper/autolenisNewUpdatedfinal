import { cn } from "@/lib/utils";

/**
 * Standard dashboard page header: an optional eyebrow row (status chips,
 * live indicators), the page title, a supporting line, and a right-aligned
 * actions slot. Keeps the four portals' headers structurally identical.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  /** Chips / badges / live indicators rendered above the title. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned actions (buttons/links). */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex items-start justify-between flex-wrap gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="flex items-center gap-2 flex-wrap mb-2">{eyebrow}</div>}
        <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/** Small pulsing live-status indicator used in header eyebrows. */
export function LiveIndicator({ label = "Live", testId }: { label?: string; testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={testId}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em]">{label}</span>
    </span>
  );
}
