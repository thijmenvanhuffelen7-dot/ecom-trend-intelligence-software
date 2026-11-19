export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "workspace.read"
  | "workspace.update"
  | "workspace.delete"
  | "members.invite"
  | "members.remove"
  | "billing.manage"
  | "api_keys.manage"
  | "watchlist.write"
  | "alerts.write"
  | "export.run";

const MATRIX: Record<Action, readonly Role[]> = {
  "workspace.read": ["owner", "admin", "member"],
  "workspace.update": ["owner", "admin"],
  "workspace.delete": ["owner"],
  "members.invite": ["owner", "admin"],
  "members.remove": ["owner", "admin"],
  "billing.manage": ["owner"],
  "api_keys.manage": ["owner", "admin"],
  "watchlist.write": ["owner", "admin", "member"],
  "alerts.write": ["owner", "admin", "member"],
  "export.run": ["owner", "admin", "member"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export class ForbiddenError extends Error {
  constructor(readonly action: Action) {
    super(`Geen toestemming voor ${action}`);
  }
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}
