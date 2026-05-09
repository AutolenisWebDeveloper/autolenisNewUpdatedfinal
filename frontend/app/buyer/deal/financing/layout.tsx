import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Financing",
  robots: { index: false, follow: false },
};
export default function FinancingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
