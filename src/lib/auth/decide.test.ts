import { describe, expect, it } from "vitest";
import { decideAuth } from "./decide";

const base = { hasUser: false, rejected: false, configured: true };

describe("request proxy decisions", () => {
  it("unauthenticated users are sent to the login screen from the app pages", () => {
    expect(decideAuth({ ...base, pathname: "/" })).toEqual({ kind: "TO_LOGIN" });
    expect(decideAuth({ ...base, pathname: "/plan" })).toEqual({ kind: "TO_LOGIN" });
  });
  it("login and the auth callback stay reachable", () => {
    expect(decideAuth({ ...base, pathname: "/login" })).toEqual({ kind: "ALLOW" });
    expect(decideAuth({ ...base, pathname: "/auth/callback" })).toEqual({ kind: "ALLOW" });
  });
  it("a verified Waterloo user enters the app and is bounced away from the login screen", () => {
    expect(decideAuth({ ...base, hasUser: true, pathname: "/plan" })).toEqual({ kind: "ALLOW" });
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
