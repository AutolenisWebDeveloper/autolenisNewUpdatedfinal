import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consistent empty-state block for dashboard panels: quiet icon, one-line
 * explanation of why it's empty, and (when there is one) the action that
 * fills it. Every empty panel should tell the user what to do next.
 */
export default function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  testId,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; href: string; testId?: string };
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn("py-8 px-5 text-center", className)}>
      {Icon && (
        <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-3">
          <Icon size={17} className="text-slate-400" />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {body && <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">{body}</p>}
      {action && (
        <Link
          href={action.href}
          data-testid={action.testId}
          className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}
