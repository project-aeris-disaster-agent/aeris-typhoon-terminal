export type AerisRole = "guest_viewer" | "volunteer" | "admin" | "ai_agent";

export type AerisUserRoleRow = {
  user_id: string;
  role: "volunteer" | "admin";
};

const ROLE_LABELS: Record<AerisRole, string> = {
  guest_viewer: "guest",
  admin: "admin",
  volunteer: "volunteer",
  ai_agent: "agent",
};

const ROLE_DESCRIPTIONS: Record<AerisRole, string> = {
  guest_viewer: "View only",
  admin: "Wallet login",
  volunteer: "Limited permissions",
  ai_agent: "AI agent",
};

export function formatAerisRoleLabel(role: AerisRole): string {
  return ROLE_LABELS[role];
}

export function getAerisRoleDescription(role: AerisRole): string {
  return ROLE_DESCRIPTIONS[role];
}

export function resolveAerisRole(
  roleRow: AerisUserRoleRow | null | undefined,
): Exclude<AerisRole, "ai_agent"> {
  if (roleRow?.role === "admin") return "admin";
  if (roleRow?.role === "volunteer") return "volunteer";
  return "guest_viewer";
}
