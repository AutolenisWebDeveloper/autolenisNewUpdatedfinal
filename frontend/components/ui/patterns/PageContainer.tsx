import { cn } from "@/lib/utils";

/**
 * Centered content shell for portal dashboard pages. Fixes the historical
 * defect where pages set a max-width without `mx-auto` and rendered hugging
 * the left edge on wide screens.
 */
export default function PageContainer({
  children,
  className,
  testId,
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  /** Admin-style dense dashboards get the wider canvas. */
  wide?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "w-full mx-auto p-6 md:p-8",
        wide ? "max-w-[1400px]" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
