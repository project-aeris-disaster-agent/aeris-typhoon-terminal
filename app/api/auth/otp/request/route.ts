import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SMS OTP auth has been disabled. Privy is the sole authentication provider.
export async function POST() {
  return NextResponse.json(
    { error: "SMS authentication is disabled." },
    { status: 410 },
  );
}
