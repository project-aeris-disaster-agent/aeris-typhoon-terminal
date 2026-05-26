"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AerisRole } from "@/lib/aeris-roles";

type RoleState = {
  role: AerisRole;
  userId: string | null;
  loading: boolean;
  authDisabled: boolean;
  refresh: () => Promise<void>;
};

const RoleContext = createContext<RoleState | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AerisRole>("guest_viewer");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authDisabled, setAuthDisabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/role", { cache: "no-store" });
      if (!res.ok) {
        setRole("guest_viewer");
        setUserId(null);
        return;
      }
      const data = (await res.json()) as {
        role?: AerisRole;
        userId?: string | null;
        authDisabled?: boolean;
      };
      setRole(data.role ?? "guest_viewer");
      setUserId(data.userId ?? null);
      setAuthDisabled(Boolean(data.authDisabled));
    } catch {
      setRole("guest_viewer");
      setUserId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ role, userId, loading, authDisabled, refresh }),
    [role, userId, loading, authDisabled, refresh],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useAerisRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useAerisRole must be used within RoleProvider");
  }
  return ctx;
}
