import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refinance Confirmation",
  robots: { index: false, follow: false },
};

export default function RefinanceConfirmLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
