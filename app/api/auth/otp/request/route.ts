import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isValidPhoneE164, normalizePhoneE164 } from "@/lib/phone-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!phone || !isValidPhoneE164(phone)) {
    return NextResponse.json(
      { error: "Enter a valid mobile number in E.164 format (e.g. +639171234567)." },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true, phone });
  const supabase = createRouteClient(request, response);

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      channel: "sms",
      shouldCreateUser: true,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, phone, message: `OTP sent to ${phone}.` },
    {
      status: 200,
      headers: response.headers,
    },
  );
}
