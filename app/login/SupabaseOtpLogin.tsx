"use client";

import { useEffect, useRef, useState } from "react";
import { normalizePhoneE164 } from "@/lib/phone-auth";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

const RESEND_COOLDOWN_SEC = 60;

type Step = "phone" | "otp";

type SupabaseOtpLoginProps = {
  onAuthenticated: () => void;
};

export function SupabaseOtpLogin({ onAuthenticated }: SupabaseOtpLoginProps) {
  const [expanded, setExpanded] = useState(false);
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

      onAuthenticated();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const phoneLocked = step === "otp";

  return (
    <div className="relative rounded-lg border border-aeris-border/70 bg-aeris-bg/40 p-4">
      {loading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-aeris-surface/85 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <AerisLoadingLogo size="md" variant="glyph" />
          <span className="text-body-sm text-aeris-muted">
            {step === "otp" ? "Verifying…" : "Sending OTP…"}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <span className="text-body-sm font-medium text-aeris-text">
          Sign in with mobile OTP
        </span>
        <span className="text-body-sm text-aeris-muted">{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <p className="text-body-sm text-aeris-muted">
            Fallback sign-in using Supabase SMS verification.
          </p>

          <label className="block text-label text-aeris-muted">
            Mobile number
            <input
              type="tel"
              value={phone}
              readOnly={phoneLocked}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1 w-full rounded border border-aeris-border bg-aeris-bg px-3 py-2.5 text-body-sm text-aeris-text disabled:opacity-70 min-h-[44px]"
              placeholder="+63XXXXXXXXXX"
            />
          </label>

          {step === "otp" && (
            <label className="block text-label text-aeris-muted">
              OTP code
              <input
                inputMode="numeric"
                maxLength={8}
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))
                }
                className="mt-1 w-full rounded border border-aeris-border bg-aeris-bg px-3 py-2.5 text-body-sm text-aeris-text min-h-[44px]"
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
                className="flex-1 rounded border border-aeris-border px-3 py-2.5 text-body-sm font-semibold text-aeris-text disabled:opacity-40 min-h-[44px]"
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
                  className="flex-1 rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2.5 text-body-sm font-semibold text-aeris-accent disabled:opacity-40 min-h-[44px]"
                >
                  {loading ? "Verifying..." : "Verify & enter"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
