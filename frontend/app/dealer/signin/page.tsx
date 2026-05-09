import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Canonical sign-in URL is /dealer/sign-in.
// This route exists only as a backward-compatibility alias.
// Forwards any query string (e.g. ?redirect=/dealer/inventory) to the canonical URL.
export default async function DealerSignInAliasPage({ searchParams }: Props) {
  const params = await searchParams;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") usp.append(key, value);
    else if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    }
  }
  const qs = usp.toString();
  redirect(`/dealer/sign-in${qs ? `?${qs}` : ""}`);
}
