import { requireDealer } from "@/lib/auth/dealer-session";
import { User } from "lucide-react";
import DealerProfileClient from "./DealerProfileClient";

export const dynamic = "force-dynamic";

export default async function DealerProfilePage() {
  const dealer = await requireDealer();
  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="dealer-profile-page">
      <div className="flex items-center gap-3 mb-6">
        <User size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Dealer Profile</h1>
      </div>
      <DealerProfileClient
        dealershipName={dealer.dealershipName}
        email={dealer.user.email}
        phone={dealer.phone}
        city={dealer.city}
        state={dealer.state}
        zip={dealer.zip}
        address={dealer.address}
      />
    </div>
  );
}
