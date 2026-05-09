import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  // Accept both tokenHash (new) and token (legacy) for backwards compatibility
  tokenHash: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  password: z.string().min(8),
}).refine(d => d.tokenHash || d.token, {
  message: "Either tokenHash or token must be provided",
  path: ["tokenHash"],
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const { token, tokenHash, password } = parsed.data;
    // Prefer tokenHash (new field name) — fall back to token for legacy clients
    const recoveryToken = (tokenHash ?? token) as string;

    // Use Supabase to verify the recovery token and update the password
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Exchange the recovery token for a session
    const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
      token_hash: recoveryToken,
      type: "recovery",
    });

    if (sessionError || !sessionData?.session) {
      return NextResponse.json({ error: "Invalid or expired token", expired: true }, { status: 400 });
    }

    // Now update the password using the session
    const authedClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
        },
      }
    );

    const { error: updateError } = await authedClient.auth.updateUser({ password });
    if (updateError) {
      return NextResponse.json({ error: "Failed to update password", expired: false }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}
