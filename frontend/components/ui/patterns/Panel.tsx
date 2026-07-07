import Link from "next/link";
import { cn } from "@/lib/utils";
import { CARD, EYEBROW } from "./tokens";

/**
 * Section card with a standard header row (eyebrow title + optional
 * "View all" action). `flush` removes body padding for list-style content
 * that manages its own row padding/dividers.
 */
export default function Panel({
  title,
  action,
  children,
  className,
  flush = false,
  testId,
}: {
  title?: string;
  /** Optional right-aligned header link. */
  action?: { label: string; href: string; testId?: string };
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={cn(CARD, "overflow-hidden", className)}>
      {(title || action) && (
        <div className={cn("flex items-center justify-between px-5 pt-5", flush ? "pb-3" : "pb-4")}>
          {title && <p className={EYEBROW}>{title}</p>}
          {action && (
            <Link
              href={action.href}
              data-testid={action.testId}
              className="text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
            >
              {action.label}
            </Link>
          )}
        </div>
      )}
      <div className={flush ? undefined : "px-5 pb-5"}>{children}</div>
    </section>
  );
}
