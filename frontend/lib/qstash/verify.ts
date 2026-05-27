import { getReceiver } from "./receiver";
import { NextRequest } from "next/server";

// Verifies the QStash signature on an incoming job request. Uses a cloned
// request to read the raw body so the route handler can still call
// `request.json()` afterwards (a request body can only be consumed once).
export async function verifyQStashRequest(
  request: NextRequest,
): Promise<boolean> {
  try {
    const signature = request.headers.get("upstash-signature");
    if (!signature) return false;

    const body = await request.clone().text();

    return await getReceiver().verify({ signature, body });
  } catch {
    return false;
  }
}

export function qstashError(message: string) {
  return Response.json({ error: message }, { status: 401 });
}
