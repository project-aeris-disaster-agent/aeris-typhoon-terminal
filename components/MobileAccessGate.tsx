"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import { MobileDesktopGate } from "@/components/MobileDesktopGate";
import { isMobileDeviceClient } from "@/lib/mobile-access";
import { useAerisRole } from "@/services/role-context";

const AUTH_SURFACES = new Set(["/login", "/refresh"]);

type MobileAccessGateProps = {
  children: ReactNode;
};

/**
 * Blocks authenticated non-admin users on mobile from using the dashboard.
 * Login / refresh pages handle their own mobile UX.
 */
export function MobileAccessGate({ children }: MobileAccessGateProps) {
  const pathname = usePathname();
  const { role, userId, loading, authDisabled } = useAerisRole();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setMobile(isMobileDeviceClient());
  }, []);

  const blocked = useMemo(() => {
    if (AUTH_SURFACES.has(pathname)) return false;
    if (!mobile || authDisabled || !userId) return false;
    if (loading) return true;
    return role !== "admin";
  }, [pathname, mobile, authDisabled, userId, loading, role]);

  if (blocked) {
    return <MobileDesktopGate />;
  }

  return <>{children}</>;
}
