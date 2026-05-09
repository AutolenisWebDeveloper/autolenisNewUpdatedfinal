import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Share your feedback with the AutoLenis team.",
  robots: { index: false, follow: false },
};

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
