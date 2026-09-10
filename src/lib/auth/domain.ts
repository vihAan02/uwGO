/**
 * Who may sign in. One exact-domain list, used by the login form, the send-code API route,
 * the auth callback, the request proxy and the database trigger (see supabase/migrations).
 */
export const ALLOWED_EMAIL_DOMAINS: readonly string[] = ["uwaterloo.ca"];

export const ACCESS_MESSAGE = "UW GO is currently available to University of Waterloo students only.";

/** Lower-cased, trimmed. Never changes the local part beyond casing. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Exact domain match after normalisation: USER@UWATERLOO.CA passes, user@uwaterloo.ca.fake.com does not. */
export function isAllowedEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  if (email.indexOf("@") !== at) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}
