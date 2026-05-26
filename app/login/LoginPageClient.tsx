"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePhoneE164 } from "@/lib/phone-auth";

const RESEND_COOLDOWN_SEC = 60;

type Step = "phone" | "otp";

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("+63");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendInSec, setResendInSec] = useState(0);
  const lockedPhoneRef = useRef<string | null>(null);

  useEffect(() => {
    if (resendInSec <= 0) return;
    const timer = window.setInterval(() => {
      setResendInSec((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendInSec]);

  useEffect(() => {
    fetch("/api/auth/role", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.userId) router.replace(nextPath);
      })
      .catch(() => undefined);
  }, [router, nextPath]);

  const requestOtp = async () => {
    setLoading(true);
    setStatus(null);
    setOtp("");
    try {
      const normalized = normalizePhoneE164(phone);
      if (!normalized) {
        throw new Error("Enter a valid mobile number in E.164 format (e.g. +639171234567).");
      }

      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone: normalized }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        phone?: string;
        message?: string;
        code?: string | null;
      };
      if (!res.ok) {
        if (res.status === 429 || data.code === "over_sms_send_rate_limit") {
          throw new Error(
            "Too many OTP requests for this number. Wait about an hour, then try again once.",
          );
        }
        throw new Error(data.error ?? `Unable to send OTP (${res.status})`);
      }

      const confirmedPhone = data.phone ?? normalized;
      lockedPhoneRef.current = confirmedPhone;
      setPhone(confirmedPhone);
      setStep("otp");
      setResendInSec(RESEND_COOLDOWN_SEC);
      setStatus(data.message ?? `OTP sent to ${confirmedPhone}.`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const verifyPhone = lockedPhoneRef.current ?? normalizePhoneE164(phone);
      if (!verifyPhone) {
        throw new Error("Invalid phone number. Go back and request a new OTP.");
      }

      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone: verifyPhone, token: otp }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          data.error?.includes("expired") || data.error?.includes("invalid")
            ? "That code is expired or invalid. Request one new OTP and enter it within a few minutes."
            : (data.error ?? `OTP verification failed (${res.status})`),
        );
      }

      router.refresh();
      router.replace(nextPath);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const phoneLocked = step === "otp";

  return (
    <div className="flex min-h-screen items-center justify-center bg-aeris-bg px-4">
      <div className="w-full max-w-md rounded-lg border border-aeris-border bg-aeris-surface p-6 shadow-xl">
        <h1 className="hud-text text-lg font-semibold text-aeris-text">AERIS Dashboard</h1>
        <p className="mt-2 text-sm text-aeris-muted">
          Sign in with your mobile number to view live disaster intelligence.
        </p>

        <div className="mt-6 space-y-3">
          <label className="block text-xs font-mono uppercase text-aeris-muted">
            Mobile number
            <input
              type="tel"
              value={phone}
              readOnly={phoneLocked}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1 w-full rounded border border-aeris-border bg-aeris-bg px-3 py-2 text-sm text-aeris-text disabled:opacity-70"
              placeholder="+63XXXXXXXXXX"
            />
          </label>

          {step === "otp" && (
            <label className="block text-xs font-mono uppercase text-aeris-muted">
              OTP code
              <input
                inputMode="numeric"
                maxLength={8}
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))
                }
                className="mt-1 w-full rounded border border-aeris-border bg-aeris-bg px-3 py-2 text-sm text-aeris-text"
                placeholder="6-digit code"
                autoComplete="one-time-code"
              />
            </label>
          )}

          {status && (
            <p className="rounded border border-aeris-border/70 bg-aeris-bg px-3 py-2 text-xs text-aeris-muted">
              {status}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            {step === "phone" ? (
              <button
                type="button"
                disabled={loading || !normalizePhoneE164(phone) || resendInSec > 0}
                onClick={() => void requestOtp()}
                className="flex-1 rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2 text-sm font-mono uppercase text-aeris-accent disabled:opacity-40"
              >
                {loading ? "Sending..." : resendInSec > 0 ? `Wait ${resendInSec}s` : "Send OTP"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setStep("phone");
                    setOtp("");
                    setStatus(null);
                  }}
                  className="rounded border border-aeris-border px-3 py-2 text-sm text-aeris-muted"
                >
                  Back
                </button>
                {resendInSec > 0 ? (
                  <button
                    type="button"
                    disabled
                    className="rounded border border-aeris-border px-3 py-2 text-sm text-aeris-muted opacity-50"
                  >
                    Resend in {resendInSec}s
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void requestOtp()}
                    className="rounded border border-aeris-border px-3 py-2 text-sm text-aeris-muted"
                  >
                    Resend OTP
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading || otp.length < 6}
                  onClick={() => void verifyOtp()}
                  className="flex-1 rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2 text-sm font-mono uppercase text-aeris-accent disabled:opacity-40"
                >
                  {loading ? "Verifying..." : "Verify & enter"}
                </button>
              </>
            )}
          </div>

          {step === "otp" && (
            <p className="text-[10px] text-aeris-muted">
              Use the latest SMS code only. Each new request invalidates the previous code.
              {resendInSec > 0
                ? ` You can request another code in ${resendInSec}s.`
                : " If nothing arrived, check Twilio logs or wait before resending."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
