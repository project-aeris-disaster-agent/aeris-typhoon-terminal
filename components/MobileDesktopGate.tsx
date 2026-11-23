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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-boot-sky px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-desktop-gate-title"
    >
      <div className="panel-glass aeris-rise w-full max-w-md rounded-3xl !shadow-hero px-6 pb-6 pt-7">
        <span
          role="img"
          aria-label="bagyo.app"
          className="aeris-brand-mark mx-auto mb-5 h-12"
        />
        <h1
          id="mobile-desktop-gate-title"
          className="text-center text-[1.375rem] font-black leading-tight text-aeris-text"
        >
          Best on a desktop
        </h1>
        <p className="mt-2 text-center text-body-sm font-bold text-aeris-ink2">
          For live updates and community chat on your phone, use bagyo.app instead.
        </p>

        <div className="mt-6 space-y-2.5">
          <a
            href={BAGYO_APP_URL}
            className="aeris-btn-cta min-h-[52px] w-full px-4 text-[0.9375rem]"
          >
            Visit bagyo.app
          </a>

          {showWalletLogin && onWalletLogin && (
            <button
              type="button"
              disabled={walletLoginDisabled}
              onClick={onWalletLogin}
              className="aeris-btn-ghost w-full min-h-[44px] px-4 text-body-sm disabled:opacity-40"
            >
              Connect wallet (admin)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
