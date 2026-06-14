# AutoLenis — Nurture SMS Copy Reference

> SMS has no template table. These bodies are pasted into the `body` field of the
> `/api/crm/dispatch/sms` call inside each Make scenario. The dispatch SMS layer
> already enforces TCPA quiet hours, explicit `consent_sms`, suppression, and
> opt-out — but each body still includes "Reply STOP to opt out." as a courtesy
> and for carrier compliance. Keep each under 160 characters so it stays a single
> segment. Variables use the same `{{...}}` tokens the email templates use.

| Campaign / trigger | Body (≤160 chars) |
|---|---|
| **Vehicle request** `vehicle_request_submitted` | `AutoLenis: {{firstName}}, your request is in. We're inviting dealers to compete. We'll text when your auction opens. Reply STOP to opt out.` |
| **Auction live** `auction_started` | `AutoLenis: {{firstName}}, your auction is live — dealers are competing now. See offers: {{auctionUrl}} Reply STOP to opt out.` |
| **Offer received** `offer_received` | `AutoLenis: New out-the-door offer in your auction, {{firstName}}. Compare it now: {{offerUrl}} Reply STOP to opt out.` |
| **Multiple offers** `offer_received` (2+) | `AutoLenis: {{firstName}}, multiple dealers have made offers. Compare side by side: {{offerUrl}} Reply STOP to opt out.` |
| **Deposit confirmed** `deposit_paid` | `AutoLenis: Deposit confirmed, {{firstName}}. Your auction can proceed. Dashboard: {{dashboardUrl}} Reply STOP to opt out.` |
| **Deal formed** `offer_selected` | `AutoLenis: {{firstName}}, you picked an offer. Next: financing, contract, pickup. Continue: {{dashboardUrl}} Reply STOP to opt out.` |
| **Contract signed** `docusign_signed` | `AutoLenis: Contract signed, {{firstName}}. Last step is pickup — details: {{dashboardUrl}} Reply STOP to opt out.` |
| **Saved search alert** `saved_search_match` | `AutoLenis: {{firstName}}, a vehicle matching your saved search is available. Start a request: {{dashboardUrl}} Reply STOP to opt out.` |
| **Win-back** `buyer_inactive` | `AutoLenis: {{firstName}}, your dealers are still ready to compete. Pick up where you left off: {{dashboardUrl}} Reply STOP to opt out.` |
| **Post-close D7** `purchase_completed` +7d | `AutoLenis: Congrats on your vehicle, {{firstName}}! How did it go? Quick feedback: {{dashboardUrl}} Reply STOP to opt out.` |

## Channel rules baked in
- **Transactional vs. promotional.** The first seven rows are tied to an active
  transaction the buyer initiated (auction, offer, deposit, contract) — legitimately
  transactional. Saved-search alert, win-back, and post-close survey lean
  promotional; they only send to contacts with `consent_sms = true`.
- **Quiet hours.** The dispatch layer suppresses sends outside the recipient's
  local 8am–9pm window and queues them; the Make scenario does not need to handle this.
- **Opt-out feedback loop.** Inbound STOP must write `consent_sms = false` +
  suppression. Confirm that path is live before turning SMS campaigns on.
- **A2P 10DLC.** None of these can deliver at scale until your 10DLC brand +
  campaign registration is approved — start that now; it is the long pole.
