"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function LogOutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function SignOutControls({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  return (
    <>
      <button
        type="button"
        onClick={() => void onSignOut()}
        className="flex h-8 shrink-0 items-center justify-center rounded border border-aeris-border px-2 text-aeris-muted hover:border-aeris-accent/40 hover:text-aeris-text sm:gap-1.5 sm:px-2.5"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOutIcon className="h-3.5 w-3.5 sm:hidden" />
        <span className="hidden text-body-sm sm:inline">Sign out</span>
      </button>
    </>
  );
}

function SupabaseSignOutButton() {
  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return <SignOutControls onSignOut={signOut} />;
}

function PrivySignOutButton() {
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

  return <SignOutControls onSignOut={signOut} />;
}

export function HeaderSignOut() {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!privyAppId) {
    return <SupabaseSignOutButton />;
  }
  return <PrivySignOutButton />;
}
