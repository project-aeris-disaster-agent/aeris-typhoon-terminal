"use client";

import { clsx } from "clsx";

export type MobileTab = "map" | "reports";

function MapIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" />
      <path d="M9 3v16M15 5v16" />
    </svg>
  );
}

function ReportsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  return (
    // The game's dock: a white pill holding a segmented track, on the sky.
    <nav
      className={clsx(
        "aeris-sky md:hidden shrink-0 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5",
      )}
      aria-label="Mobile navigation"
    >
      <div className="aeris-pill-surface flex h-14 items-stretch gap-1 rounded-2xl p-1.5">
      <TabButton
        label="Map"
        active={active === "map"}
        onClick={() => onChange("map")}
      >
        <MapIcon className="h-5 w-5" />
      </TabButton>
      <TabButton
        label="Reports"
        active={active === "reports"}
        onClick={() => onChange("reports")}
      >
        <ReportsIcon className="h-5 w-5" />
      </TabButton>
      </div>
    </nav>
  );
}

function TabButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-xl transition-colors",
        active
          ? "bg-aeris-chip-on text-aeris-kicker-ink"
          : "text-aeris-ink2 hover:text-aeris-accent",
      )}
    >
      {children}
      <span className="text-[0.75rem] font-extrabold">{label}</span>
    </button>
  );
}
