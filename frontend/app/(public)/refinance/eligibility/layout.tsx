import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refinance Eligibility Check",
  robots: { index: false, follow: false },
};

export default function RefinanceEligibilityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
