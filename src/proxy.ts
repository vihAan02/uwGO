import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authMode, supabaseEnv } from "@/lib/supabase/env";
import { isAllowedEmail } from "@/lib/auth/domain";
import { decideAuth } from "@/lib/auth/decide";

/**
 * Runs before every page and API request (static assets excluded by the matcher below).
 * Refreshes the Supabase session cookie, then: no verified Waterloo user -> /login;
 * a session with any other email -> signed out and told why; a signed-in user on /login -> /plan.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const mode = authMode();

  if (mode === "DEV_BYPASS") {
    return decideAuth({ pathname, hasUser: true, rejected: false, configured: true }).kind === "TO_APP"
      ? NextResponse.redirect(new URL("/plan", request.url))
      : NextResponse.next({ request });
  }

  const env = supabaseEnv();
  if (!env) {
    const d = decideAuth({ pathname, hasUser: false, rejected: false, configured: false });
    if (d.kind === "TO_LOGIN") return NextResponse.redirect(new URL("/login?error=unconfigured", request.url));
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the token with Supabase; getSession() would trust the cookie.
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  const hasUser = Boolean(email && isAllowedEmail(email));
  const rejected = Boolean(email) && !hasUser;

  const d = decideAuth({ pathname, hasUser, rejected, configured: true });
  switch (d.kind) {
    case "SIGN_OUT_DOMAIN": {
      await supabase.auth.signOut();
      const url = new URL("/login?error=domain", request.url);
      const out = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) out.cookies.set(c);
      return out;
    }
    case "TO_LOGIN": {
      const url = new URL("/login", request.url);
      if (pathname !== "/" && pathname !== "/plan") url.searchParams.set("next", pathname);
      const out = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) out.cookies.set(c);
      return out;
    }
    case "TO_APP": {
      const out = NextResponse.redirect(new URL("/plan", request.url));
      for (const c of response.cookies.getAll()) out.cookies.set(c);
      return out;
    }
    default:
      return response;
  }
}

export const config = {
  // Everything except Next internals, the service worker, the manifest, icons and images.
  matcher: ["/((?!_next/static|_next/image|sw\\.js|manifest\\.webmanifest|icon\\.svg|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
