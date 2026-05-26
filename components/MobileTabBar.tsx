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
    <nav
      className={clsx(
        "md:hidden shrink-0 border-t border-aeris-border bg-aeris-surface/95 backdrop-blur-md",
        "flex items-stretch h-14 shadow-[0_-2px_14px_rgba(15,23,42,0.08)]",
      )}
      aria-label="Mobile navigation"
    >
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
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-mono transition-colors",
        active
          ? "text-aeris-accent bg-aeris-accent/5"
          : "text-aeris-muted hover:text-aeris-text",
      )}
    >
      {children}
      <span className="tracking-wide uppercase text-[10px]">{label}</span>
    </button>
  );
}
