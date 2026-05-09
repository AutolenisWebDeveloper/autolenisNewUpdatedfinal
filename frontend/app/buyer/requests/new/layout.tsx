import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "New Vehicle Request",
  robots: { index: false, follow: false },
};
export default function NewRequestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
