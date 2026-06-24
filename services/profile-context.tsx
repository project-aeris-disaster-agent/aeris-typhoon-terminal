"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAerisRole } from "@/services/role-context";

export type ClientUserProfile = {
  userId: string;
  email: string | null;
  username: string;
  proxyWalletAddress: string | null;
  walletChain: string;
  barangay: string | null;
  phone: string | null;
  socials: Record<string, string>;
  avatarUrl: string | null;
  stormEmailEnabled: boolean;
  xp: number;
  level: number;
  createdAt: string;
  updatedAt: string;
};

export type ProfileUpdateInput = {
  username?: string;
  barangay?: string | null;
  phone?: string | null;
  socials?: Record<string, string>;
  avatar_url?: string | null;
  storm_email_enabled?: boolean;
};

export type ProfileUpdateResult =
  | { ok: true; profile: ClientUserProfile }
  | { ok: false; error: string };

type ProfileState = {
  profile: ClientUserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateProfile: (input: ProfileUpdateInput) => Promise<ProfileUpdateResult>;
};

const ProfileContext = createContext<ProfileState | null>(null);

// Usage-time heartbeat cadence. The server only awards once per 15-min bucket,
// so pinging more often just keeps totals current without farming XP.
const HEARTBEAT_MS = 3 * 60 * 1000;

function applyProfilePatch(
  prev: ClientUserProfile,
  input: ProfileUpdateInput,
): ClientUserProfile {
  return {
    ...prev,
    ...(input.username !== undefined && { username: input.username }),
    ...(input.barangay !== undefined && { barangay: input.barangay }),
    ...(input.phone !== undefined && { phone: input.phone }),
    ...(input.socials !== undefined && { socials: input.socials }),
    ...(input.avatar_url !== undefined && { avatarUrl: input.avatar_url }),
    ...(input.storm_email_enabled !== undefined && {
      stormEmailEnabled: input.storm_email_enabled,
    }),
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { userId, authDisabled, loading: roleLoading } = useAerisRole();
  const [profile, setProfile] = useState<ClientUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const syncedRef = useRef(false);

  const isAuthed = authDisabled || Boolean(userId);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/user/profile", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { profile?: ClientUserProfile };
      if (data.profile) setProfile(data.profile);
    } catch {
      // Non-fatal: profile UI degrades to "unavailable".
    }
  }, []);

  // Sync (create-if-missing) once per authenticated session, then load profile.
  useEffect(() => {
    if (roleLoading || !isAuthed || syncedRef.current) return;
    syncedRef.current = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/user/sync", {
          method: "POST",
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as { profile?: ClientUserProfile };
          if (data.profile) {
            setProfile(data.profile);
            return;
          }
        }
        await refresh();
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [roleLoading, isAuthed, refresh]);

  // Reset when the signed-in identity changes.
  useEffect(() => {
    syncedRef.current = false;
    setProfile(null);
  }, [userId, authDisabled]);

  const updateProfile = useCallback(
    async (input: ProfileUpdateInput): Promise<ProfileUpdateResult> => {
      let snapshot: ClientUserProfile | null = null;
      setProfile((prev) => {
        if (!prev) return prev;
        snapshot = prev;
        return applyProfilePatch(prev, input);
      });

      try {
        const res = await fetch("/api/user/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = (await res.json().catch(() => ({}))) as {
          profile?: ClientUserProfile;
          error?: string;
        };
        if (!res.ok || !data.profile) {
          if (snapshot) setProfile(snapshot);
          return { ok: false, error: data.error ?? "Failed to update profile." };
        }
        setProfile(data.profile);
        return { ok: true, profile: data.profile };
      } catch {
        if (snapshot) setProfile(snapshot);
        return { ok: false, error: "Network error. Please try again." };
      }
    },
    [],
  );

  // Usage-time heartbeat while the tab is visible.
  useEffect(() => {
    if (!isAuthed) return;

    let cancelled = false;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/user/activity", {
          method: "POST",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          awarded?: boolean;
          xp?: number | null;
          level?: number | null;
        };
        if (!cancelled && data.awarded && typeof data.xp === "number") {
          setProfile((prev) =>
            prev
              ? { ...prev, xp: data.xp as number, level: data.level ?? prev.level }
              : prev,
          );
        }
      } catch {
        // ignore
      }
    };

    void ping();
    const id = window.setInterval(() => void ping(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAuthed]);

  const value = useMemo(
    () => ({ profile, loading, refresh, updateProfile }),
    [profile, loading, refresh, updateProfile],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useUserProfile must be used within ProfileProvider");
  }
  return ctx;
}
