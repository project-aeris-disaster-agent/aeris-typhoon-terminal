export type AerisRole = "guest_viewer" | "volunteer" | "admin" | "ai_agent";

export type AerisUserRoleRow = {
  user_id: string;
  role: "volunteer" | "admin";
};

export function resolveAerisRole(
  roleRow: AerisUserRoleRow | null | undefined,
): Exclude<AerisRole, "ai_agent"> {
  if (roleRow?.role === "admin") return "admin";
  if (roleRow?.role === "volunteer") return "volunteer";
  return "guest_viewer";
}
