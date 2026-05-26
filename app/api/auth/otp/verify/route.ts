import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isValidPhoneE164, normalizePhoneE164 } from "@/lib/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFY_TYPES = ["sms", "signup", "phone_change"] as const;

function createRouteClient(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const phone = normalizePhoneE164(String(record.phone ?? ""));
  const token = String(record.token ?? "").replace(/\D/g, "").slice(0, 8);

  if (!phone || !isValidPhoneE164(phone)) {
    return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
  }
  if (token.length < 6) {
    return NextResponse.json({ error: "Enter the full OTP code from SMS." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createRouteClient(request, response);

  let lastError: string | null = null;

  for (const type of VERIFY_TYPES) {
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type,
    });

    if (!error && data.session) {
      return NextResponse.json(
        { ok: true, userId: data.user?.id ?? null },
        { status: 200, headers: response.headers },
      );
    }

    lastError = error?.message ?? lastError;
    if (error && !/expired|invalid|token/i.test(error.message)) {
      break;
    }
  }

  return NextResponse.json(
    {
      error:
        lastError ??
        "OTP verification failed. Request a new code and try again within a few minutes.",
    },
    { status: 403 },
  );
}
