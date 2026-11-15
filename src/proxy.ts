import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, isAuthConfigured } from "@/server/supabase/config";
import { LEGACY_PUBLIC_APP_ORIGIN, PRODUCTION_SUPABASE_URL, PUBLIC_APP_ORIGIN } from "@/shared/app-origin";

const publicHost = new URL(PUBLIC_APP_ORIGIN).host;
const legacyHost = new URL(LEGACY_PUBLIC_APP_ORIGIN).host;
const legacyAliases = new Set(["iteamsystems.com", "www.iteamsystems.com"]);
const legacyCallbackPaths = new Set(["/auth/confirm", "/ru/free/confirm", "/ru/team/join", "/ru/team/confirm"]);
const legacySignedInPaths = new Set(["/ru/verification-complete", "/ru/account", "/ru/dashboard", "/ru/company-profile", "/ru/companies"]);
const uuidPathSegment = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const participantPath = new RegExp("^/ru/team/responses/" + uuidPathSegment + "(?:/result)?$", "i");
const diagnosticResultPath = new RegExp("^/ru/diagnostics/" + uuidPathSegment + "/result$", "i");
const productionSessionCookie = /^sb-fhvxqeaujjeiflanqsbg-auth-token(?:\.\d+)?$/;

function continuesLegacyFlow(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (legacyCallbackPaths.has(pathname)) return true;
  if (pathname === "/ru/free") return request.cookies.has("aca-anonymous");
  if (pathname === "/ru/reset-password") return request.cookies.has("auth-recovery");
  if (pathname === "/ru/login" || pathname === "/ru/register") {
    return searchParams.get("next") === "team-invitation" && request.cookies.has("team-invitation");
  }
  // The old link may lead directly to a page that needs the session just established there.
  const needsSession = legacySignedInPaths.has(pathname) || participantPath.test(pathname) || diagnosticResultPath.test(pathname)
    || (pathname === "/ru/billing/return" && searchParams.has("checkout"));
  return needsSession && request.cookies.getAll().some(({ name }) => productionSessionCookie.test(name));
}

function canonicalRedirect(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return;
  if (process.env.NODE_ENV !== "production" || process.env.SUPABASE_URL !== PRODUCTION_SUPABASE_URL) return;

  // Next's Node server can construct nextUrl with its internal bind host.
  const incomingHost = request.headers.get("host") ?? request.nextUrl.host;
  const configuredOrigin = process.env.APP_URL;
  if (configuredOrigin === PUBLIC_APP_ORIGIN) {
    if (!legacyAliases.has(incomingHost) && (incomingHost !== legacyHost || continuesLegacyFlow(request))) return;
  } else if (configuredOrigin === LEGACY_PUBLIC_APP_ORIGIN) {
    if (incomingHost !== publicHost && !legacyAliases.has(incomingHost)) return;
  } else {
    return;
  }

  const target = new URL(configuredOrigin);
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, configuredOrigin === PUBLIC_APP_ORIGIN ? 307 : 308);
}

export async function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  let response = redirect ?? NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const refreshSession = path === "/ru" || path.startsWith("/ru/") || path === "/auth" || path.startsWith("/auth/");
  if (!redirect && refreshSession && isAuthConfigured()) {
    const config = authConfig();
    const supabase = createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getUser();
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: ["/", "/ru/:path*", "/en/:path*", "/auth/:path*"] };
