"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Pill } from "@/components/ui/Card";
import { NAGA_BARANGAYS } from "@/config/barangays";
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

const OTHER_BARANGAY = "__other__";

// Per-field XP awarded once when a field is first completed. Mirrors the
// per-field awards in app/api/user/profile/route.ts so the UI can preview them.
const FIELD_XP = { barangay: 10, phone: 10, social: 5 } as const;

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ProfilePanel() {
  const { profile, loading, updateProfile } = useUserProfile();

  const [username, setUsername] = useState("");
  const [barangaySelect, setBarangaySelect] = useState("");
  const [barangayOther, setBarangayOther] = useState("");
  const [phone, setPhone] = useState("");
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [socialOpen, setSocialOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; msg: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? "");
    const savedBarangay = profile.barangay ?? "";
    if (savedBarangay && NAGA_BARANGAYS.includes(savedBarangay)) {
      setBarangaySelect(savedBarangay);
      setBarangayOther("");
    } else if (savedBarangay) {
      setBarangaySelect(OTHER_BARANGAY);
      setBarangayOther(savedBarangay);
    } else {
      setBarangaySelect("");
      setBarangayOther("");
    }
    setPhone(profile.phone ?? "");
    setSocials(profile.socials ?? {});
    if (profile.socials && Object.keys(profile.socials).length > 0) {
      setSocialOpen(true);
    }
  }, [profile]);

  const resolvedBarangay = useMemo(
    () =>
      barangaySelect === OTHER_BARANGAY
        ? barangayOther.trim()
        : barangaySelect.trim(),
    [barangaySelect, barangayOther],
  );

  const progress = useMemo(
    () => levelProgress(profile?.xp ?? 0),
    [profile?.xp],
  );

  const hasSocial = useMemo(
    () => Object.values(socials).some((v) => v.trim().length > 0),
    [socials],
  );

  // Profile-completion checklist drives the "more fields, more XP" hint.
  const completion = useMemo(() => {
    const items = [
      { key: "barangay", label: "Barangay", done: resolvedBarangay.length > 0, xp: FIELD_XP.barangay },
      { key: "phone", label: "Phone number", done: phone.trim().length > 0, xp: FIELD_XP.phone },
      { key: "social", label: "A social link", done: hasSocial, xp: FIELD_XP.social },
    ];
    const earned = items.filter((i) => i.done).reduce((sum, i) => sum + i.xp, 0);
    const total = items.reduce((sum, i) => sum + i.xp, 0);
    const doneCount = items.filter((i) => i.done).length;
    return { items, earned, total, doneCount };
  }, [resolvedBarangay, phone, hasSocial]);

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
      barangay: resolvedBarangay || null,
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
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-aeris-accent/30 bg-aeris-accent/10 text-body-lg font-semibold text-aeris-accent">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm font-semibold text-aeris-text">
            {profile.username}
          </div>
          <div className="truncate text-xs text-aeris-muted">
            {profile.email ?? "No email linked"}
          </div>
          {profile.proxyWalletAddress ? (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-aeris-muted hover:text-aeris-accent"
              title="Copy wallet address"
            >
              <span className="truncate">
                {shortenAddress(profile.proxyWalletAddress)}
              </span>
              <span className="shrink-0 opacity-70">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
          ) : (
            <div className="mt-0.5 text-xs text-aeris-muted">
              Wallet provisioning…
            </div>
          )}
        </div>
        <div className="shrink-0">
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

      {/* Profile completion → XP hint */}
      <div className="mt-3 rounded-md border border-aeris-border bg-aeris-bg/60 p-2">
        <div className="flex items-center justify-between">
          <span className="chrome-label text-aeris-muted">Complete your profile</span>
          <span className="font-mono text-xs text-aeris-accent">
            +{completion.earned}/{completion.total} XP
          </span>
        </div>
        <ul className="mt-1.5 space-y-1">
          {completion.items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between text-xs"
            >
              <span
                className={clsx(
                  "flex items-center gap-1.5",
                  item.done ? "text-aeris-text" : "text-aeris-muted",
                )}
              >
                <span
                  className={clsx(
                    "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] leading-none",
                    item.done
                      ? "border-aeris-ok/50 bg-aeris-ok/15 text-aeris-ok"
                      : "border-aeris-border text-transparent",
                  )}
                >
                  ✓
                </span>
                {item.label}
              </span>
              <span className="font-mono text-aeris-muted">+{item.xp}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Editable basics */}
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
          <select
            value={barangaySelect}
            onChange={(e) => setBarangaySelect(e.target.value)}
            className={inputClass}
          >
            <option value="">Select barangay…</option>
            {NAGA_BARANGAYS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value={OTHER_BARANGAY}>Other…</option>
          </select>
          {barangaySelect === OTHER_BARANGAY && (
            <input
              value={barangayOther}
              onChange={(e) => setBarangayOther(e.target.value)}
              className={clsx(inputClass, "mt-2")}
              maxLength={120}
              placeholder="Enter your barangay / locality"
            />
          )}
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

        {/* Optional collapsible social links */}
        <div className="rounded-md border border-aeris-border bg-aeris-bg/40">
          <button
            type="button"
            onClick={() => setSocialOpen((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-2 text-left"
            aria-expanded={socialOpen}
          >
            <span className="chrome-label text-aeris-muted">
              Social{" "}
              <span className="text-aeris-muted/70">(optional)</span>
            </span>
            <span className="text-xs text-aeris-muted">{socialOpen ? "▲" : "▼"}</span>
          </button>
          {socialOpen && (
            <div className="grid grid-cols-1 gap-2 px-2 pb-2">
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
          )}
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
