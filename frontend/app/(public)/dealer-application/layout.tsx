import type { Metadata } from "next";
import { buildPageMetadata, PAGE_METADATA } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata(PAGE_METADATA.dealerApplication);

export default function DealerApplicationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
