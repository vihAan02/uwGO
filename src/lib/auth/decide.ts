/**
 * The routing decision the request proxy makes, kept pure so it can be tested without
 * Next or Supabase. The landing page at / and everything under /login are public; the app
 * itself (/setup, /plan) and its API routes need a verified Waterloo user. A signed-in user who opens the
 * landing page or the login screen is sent straight into the app.
 */
export type AuthDecision =
  | { kind: "ALLOW" }
  | { kind: "TO_LOGIN"; reason?: "domain" | "unconfigured" }
  | { kind: "TO_APP" }
  | { kind: "SIGN_OUT_DOMAIN" };

export interface DecisionInput {
  pathname: string;
  /** A verified user with an allowed email exists. */
  hasUser: boolean;
  /** A session exists but its email is not allowed. */
  rejected: boolean;
  configured: boolean;
}

export const PUBLIC_PREFIXES = ["/login"];

export function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function decideAuth(i: DecisionInput): AuthDecision {
  if (i.rejected) return { kind: "SIGN_OUT_DOMAIN" };
  const isPublic = isPublicPath(i.pathname);
  if (i.hasUser) return isPublic && (i.pathname === "/" || i.pathname.startsWith("/login")) ? { kind: "TO_APP" } : { kind: "ALLOW" };
  if (isPublic) return { kind: "ALLOW" };
  if (i.pathname.startsWith("/api/")) return { kind: "ALLOW" }; // API routes answer 401 themselves, with JSON
  return { kind: "TO_LOGIN", reason: i.configured ? undefined : "unconfigured" };
}
