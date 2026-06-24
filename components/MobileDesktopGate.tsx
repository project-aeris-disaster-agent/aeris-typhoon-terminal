"use client";

import { BAGYO_APP_URL } from "@/lib/mobile-access";

type MobileDesktopGateProps = {
  /** When true, show a wallet connect affordance for admin mobile login. */
  showWalletLogin?: boolean;
  onWalletLogin?: () => void;
  walletLoginDisabled?: boolean;
};

export function MobileDesktopGate({
  showWalletLogin = false,
  onWalletLogin,
  walletLoginDisabled = false,
}: MobileDesktopGateProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-aeris-bg/95 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-desktop-gate-title"
    >
      <div className="w-full max-w-md rounded-lg border border-aeris-border bg-aeris-surface p-6 shadow-xl">
        <img
          src="/assets/Bagyo%20Logo%405x.png"
          alt="bagyo.app"
          className="mx-auto mb-5 h-12 w-auto"
        />
        <h1
          id="mobile-desktop-gate-title"
          className="text-center text-body-lg font-semibold text-aeris-text"
        >
          This Application Is best used on Desktop
        </h1>
        <p className="mt-3 text-center text-body-sm text-aeris-muted">
          For live updates and community chat on your phone, use bagyo.app instead.
        </p>

        <div className="mt-6 space-y-2">
          <a
            href={BAGYO_APP_URL}
            className="flex min-h-[44px] w-full items-center justify-center rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2.5 text-body-sm font-semibold text-aeris-accent"
          >
            visit bagyo.app
          </a>

          {showWalletLogin && onWalletLogin && (
            <button
              type="button"
              disabled={walletLoginDisabled}
              onClick={onWalletLogin}
              className="w-full rounded border border-aeris-border bg-aeris-bg/70 px-3 py-2.5 text-body-sm font-semibold text-aeris-text disabled:opacity-40 min-h-[44px]"
            >
              Connect wallet (admin)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
