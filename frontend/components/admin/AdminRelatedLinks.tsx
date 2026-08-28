import Link from "next/link";

/**
 * A labelled row of sibling destinations for a section's landing page.
 *
 * Batch 2 IA: consolidating the 74-entry rail moved a number of secondary
 * surfaces off the sidebar. A page without a rail entry is only reachable if
 * its parent links to it, so this renders that link set in one consistent,
 * accessible place rather than as ad-hoc anchors bolted onto each header.
 *
 * lib/admin/__tests__/nav-capability-preservation.test.ts asserts that every
 * such parent→child link actually exists, so removing one fails the build
 * instead of quietly orphaning a page.
 */
export function AdminRelatedLinks({
  label,
  links,
  className = "",
}: {
  /** Accessible name for the group, e.g. "Request views". */
  label: string;
  links: readonly { href: string; label: string; testId?: string }[];
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <nav
      aria-label={label}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}
      data-testid="admin-related-links"
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          data-testid={link.testId}
          className="text-sm font-medium text-al-primary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-1"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
