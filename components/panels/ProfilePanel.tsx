"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Pill } from "@/components/ui/Card";
import { levelProgress, MAX_LEVEL } from "@/lib/gamification";
import { useUserProfile } from "@/services/profile-context";

const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "twitter", label: "Twitter / X", placeholder: "@handle" },
  { key: "facebook", label: "Facebook", placeholder: "facebook.com/you" },
  { key: "instagram", label: "Instagram", placeholder: "@handle" },
  { key: "telegram", label: "Telegram", placeholder: "@handle" },
  { key: "discord", label: "Discord", placeholder: "you#0000" },
  { key: "website", label: "Website", placeholder: "https://…" },
];

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ProfilePanel() {
  const { profile, loading, updateProfile } = useUserProfile();

  const [username, setUsername] = useState("");
  const [barangay, setBarangay] = useState("");
  const [phone, setPhone] = useState("");
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; msg: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? "");
    setBarangay(profile.barangay ?? "");
    setPhone(profile.phone ?? "");
    setSocials(profile.socials ?? {});
  }, [profile]);

  const progress = useMemo(
    () => levelProgress(profile?.xp ?? 0),
    [profile?.xp],
  );

  if (loading && !profile) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-body-sm text-aeris-muted">
        Loading profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-body-sm text-aeris-muted">
        Profile unavailable. Sign in to view your AERIS profile.
      </div>
    );
  }

  const handleCopy = async () => {
    if (!profile.proxyWalletAddress) return;
    try {
      await navigator.clipboard.writeText(profile.proxyWalletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const cleanedSocials = Object.fromEntries(
      Object.entries(socials)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v.length > 0),
    );
    const result = await updateProfile({
      username: username.trim(),
      barangay: barangay.trim() || null,
      phone: phone.trim() || null,
      socials: cleanedSocials,
    });
    setSaving(false);
    setStatus(
      result.ok
        ? { tone: "ok", msg: "Profile saved." }
        : { tone: "err", msg: result.error },
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* Identity + level */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-aeris-accent/30 bg-aeris-accent/10 text-body-lg font-semibold text-aeris-accent">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-aeris-text">
            {profile.username}
          </div>
          <div className="truncate text-xs text-aeris-muted">
            {profile.email ?? "No email linked"}
          </div>
        </div>
        <div className="ml-auto">
          <Pill tone="accent">Lv {profile.level}</Pill>
        </div>
      </div>

      {/* XP progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-aeris-muted">
          <span className="font-mono">{profile.xp.toLocaleString()} XP</span>
          <span>
            {progress.isMax
              ? "Max level"
              : `${progress.xpIntoLevel.toLocaleString()} / ${progress.xpForNextLevel.toLocaleString()} to Lv ${Math.min(
                  profile.level + 1,
                  MAX_LEVEL,
                )}`}
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-aeris-elev">
          <div
            className="h-full rounded-full bg-aeris-accent transition-[width]"
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
      </div>

      {/* Proxy wallet */}
      <div className="mt-3 rounded-md border border-aeris-border bg-aeris-bg/60 p-2">
        <div className="chrome-label text-aeris-muted">Proxy wallet (SKALE-Base)</div>
        {profile.proxyWalletAddress ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="mt-1 flex w-full items-center justify-between gap-2 text-left font-mono text-xs text-aeris-text hover:text-aeris-accent"
            title="Copy wallet address"
          >
            <span className="truncate">
              {shortenAddress(profile.proxyWalletAddress)}
            </span>
            <span className="shrink-0 text-aeris-muted">
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        ) : (
          <div className="mt-1 text-xs text-aeris-muted">
            Provisioning… reload after your wallet is created.
          </div>
        )}
      </div>

      {/* Editable details */}
      <div className="mt-3 space-y-2.5">
        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            maxLength={24}
            placeholder="username"
          />
        </Field>
        <Field label="Barangay">
          <input
            value={barangay}
            onChange={(e) => setBarangay(e.target.value)}
            className={inputClass}
            maxLength={120}
            placeholder="Barangay, City"
          />
        </Field>
        <Field label="Phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
            maxLength={20}
            placeholder="+63…"
            inputMode="tel"
          />
        </Field>

        <div className="pt-1">
          <div className="chrome-label mb-1 text-aeris-muted">Social links</div>
          <div className="grid grid-cols-1 gap-2">
            {SOCIAL_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} compact>
                <input
                  value={socials[field.key] ?? ""}
                  onChange={(e) =>
                    setSocials((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                  className={inputClass}
                  maxLength={200}
                  placeholder={field.placeholder}
                />
              </Field>
            ))}
          </div>
        </div>
      </div>

      {status && (
        <p
          className={clsx(
            "mt-3 rounded border px-2 py-1.5 text-xs",
            status.tone === "ok"
              ? "border-aeris-ok/30 bg-aeris-ok/10 text-aeris-ok"
              : "border-aeris-danger/30 bg-aeris-danger/10 text-aeris-danger",
          )}
        >
          {status.msg}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className="mt-3 w-full rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2 text-body-sm font-semibold text-aeris-accent disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}

const inputClass =
  "w-full rounded border border-aeris-border bg-aeris-bg px-2 py-1.5 text-body-sm text-aeris-text outline-none focus:border-aeris-accent/50";

function Field({
  label,
  children,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={clsx(
          "chrome-label text-aeris-muted",
          compact ? "mb-0.5 block" : "mb-1 block",
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
