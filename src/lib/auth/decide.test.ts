import { describe, expect, it } from "vitest";
import { decideAuth } from "./decide";

const base = { hasUser: false, rejected: false, configured: true };

describe("request proxy decisions", () => {
  it("unauthenticated users are sent to the login screen from the app pages", () => {
    expect(decideAuth({ ...base, pathname: "/setup" })).toEqual({ kind: "TO_LOGIN" });
    expect(decideAuth({ ...base, pathname: "/plan" })).toEqual({ kind: "TO_LOGIN" });
  });
  it("the landing page at the root is public, without opening any other path", () => {
    for (const configured of [true, false]) {
      expect(decideAuth({ ...base, configured, pathname: "/" })).toEqual({ kind: "ALLOW" });
      // /landing is redirected to / by next.config before the proxy runs; it is not public on its own.
      for (const pathname of ["/landing", "/setup", "/plan", "/x"]) {
        expect(decideAuth({ ...base, configured, pathname }).kind).toBe("TO_LOGIN");
      }
    }
  });
  it("a signed-in user who opens the landing page goes straight into the app", () => {
    expect(decideAuth({ ...base, hasUser: true, pathname: "/" })).toEqual({ kind: "TO_APP" });
    expect(decideAuth({ ...base, rejected: true, pathname: "/" })).toEqual({ kind: "SIGN_OUT_DOMAIN" });
  });
  it("login stays reachable; sign-in is code only, so there is no public link callback", () => {
    expect(decideAuth({ ...base, pathname: "/login" })).toEqual({ kind: "ALLOW" });
    expect(decideAuth({ ...base, pathname: "/auth/callback" }).kind).toBe("TO_LOGIN");
  });
  it("a verified Waterloo user enters the app and is bounced away from the login screen", () => {
    expect(decideAuth({ ...base, hasUser: true, pathname: "/plan" })).toEqual({ kind: "ALLOW" });
    expect(decideAuth({ ...base, hasUser: true, pathname: "/setup" })).toEqual({ kind: "ALLOW" });
    expect(decideAuth({ ...base, hasUser: true, pathname: "/login" })).toEqual({ kind: "TO_APP" });
  });
  it("a session with a non-Waterloo email is signed out, wherever it goes", () => {
    expect(decideAuth({ ...base, rejected: true, pathname: "/plan" })).toEqual({ kind: "SIGN_OUT_DOMAIN" });
    expect(decideAuth({ ...base, rejected: true, pathname: "/login" })).toEqual({ kind: "SIGN_OUT_DOMAIN" });
  });
  it("API routes are left to answer 401 themselves; an unconfigured server fails closed", () => {
    expect(decideAuth({ ...base, pathname: "/api/routes" })).toEqual({ kind: "ALLOW" });
    expect(decideAuth({ ...base, configured: false, pathname: "/plan" })).toEqual({ kind: "TO_LOGIN", reason: "unconfigured" });
  });
});
