// The dealer application lives at ONE canonical URL: /dealer-application.
//
// This path previously rendered a second, divergent application form that
// posted to the same endpoint with a different field set, which is why the API
// carried back-compat shims (optional dealershipType, streetAddress merged into
// notes). Both the duplicate form and those shims are gone; this route is kept
// only so existing links and bookmarks continue to work.
import { redirect } from "next/navigation";

export default function DealerApplyRedirect() {
  redirect("/dealer-application");
}
