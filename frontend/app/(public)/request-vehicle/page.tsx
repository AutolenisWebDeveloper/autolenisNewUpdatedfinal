import type { Metadata } from "next";
import RequestVehicleFormClient from "@/components/public/RequestVehicleFormClient";

export const metadata: Metadata = {
  title: "Request a Vehicle — AutoLenis",
  description:
    "Tell us what vehicle you're looking for and we'll connect you with dealers who compete for your business.",
  robots: { index: true, follow: true },
};

export default function RequestVehiclePage() {
  return <RequestVehicleFormClient />;
}
