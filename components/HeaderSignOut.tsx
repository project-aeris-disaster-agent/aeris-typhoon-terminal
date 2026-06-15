"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Pill } from "./ui/Card";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { AerisRole } from "@/lib/aeris-roles";

type HeaderSignOutProps = {
  role: AerisRole;
};

function SupabaseSignOutButton({ role }: HeaderSignOutProps) {
  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <>
      <Pill tone={role === "admin" ? "ok" : "warn"}>{role}</Pill>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded border border-aeris-border px-2 py-1 text-body-sm text-aeris-muted hover:border-aeris-accent/40 hover:text-aeris-text"
      >
        Sign out
      </button>
    </>
  );
}

function PrivySignOutButton({ role }: HeaderSignOutProps) {
  const { logout, authenticated } = usePrivy();

  const signOut = async () => {
    if (authenticated) {
      await logout();
    }
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <>
      <Pill tone={role === "admin" ? "ok" : "warn"}>{role}</Pill>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded border border-aeris-border px-2 py-1 text-body-sm text-aeris-muted hover:border-aeris-accent/40 hover:text-aeris-text"
      >
        Sign out
      </button>
    </>
  );
}

export function HeaderSignOut({ role }: HeaderSignOutProps) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!privyAppId) {
    return <SupabaseSignOutButton role={role} />;
  }
  return <PrivySignOutButton role={role} />;
}
