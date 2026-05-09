// Smoke test: with MARKETCHECK_API_KEY unset, adapter must return [] without error.
import { MarketCheckAdapter } from "../lib/services/inventory/adapters/marketcheck.adapter";

delete process.env.MARKETCHECK_API_KEY;
const adapter = new MarketCheckAdapter();
adapter.search({ zip: "10001", radius: 50 }).then((r) => {
  console.log("RESULT:", JSON.stringify({ adapter: r.adapter, vehicles: r.vehicles.length, error: r.error ?? null }));
  if (r.error || r.vehicles.length !== 0) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS — adapter skipped gracefully");
  process.exit(0);
});
