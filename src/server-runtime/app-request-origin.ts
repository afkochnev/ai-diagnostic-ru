import { LEGACY_PUBLIC_APP_ORIGIN, PRODUCTION_SUPABASE_URL, PUBLIC_APP_ORIGIN } from "@/shared/app-origin";

type RequestHeaders = Pick<Headers, "get">;
const legacyHost = new URL(LEGACY_PUBLIC_APP_ORIGIN).host;

export function isLegacyContinuationOrigin(headers: RequestHeaders, env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production"
    && env.APP_URL === PUBLIC_APP_ORIGIN
    && env.SUPABASE_URL === PRODUCTION_SUPABASE_URL
    && headers.get("origin") === LEGACY_PUBLIC_APP_ORIGIN
    && headers.get("host") === legacyHost;
}

export function isAppRequestOrigin(headers: RequestHeaders, configuredOrigin: string, allowLegacyContinuation = false) {
  return headers.get("origin") === configuredOrigin
    || (allowLegacyContinuation && configuredOrigin === PUBLIC_APP_ORIGIN && isLegacyContinuationOrigin(headers));
}
