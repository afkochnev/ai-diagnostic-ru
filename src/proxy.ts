import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, isAuthConfigured } from "@/server/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (isAuthConfigured()) {
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

export const config = { matcher: ["/ru/:path*", "/auth/:path*"] };
