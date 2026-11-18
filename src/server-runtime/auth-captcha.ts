/** Public widget settings are read at runtime; the provider secret stays in Supabase. */
export type AuthCaptchaConfig = { enabled: boolean; siteKey: string | null; configured: boolean };

export function authCaptchaConfig(env: Record<string, string | undefined> = process.env): AuthCaptchaConfig {
  const flag = env.AUTH_CAPTCHA_ENABLED?.trim();
  // An unrecognised non-empty flag must not silently turn protection off.
  const enabled = Boolean(flag && flag !== "false");
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const configured = !enabled || (flag === "true" && Boolean(siteKey && /^[A-Za-z0-9_-]{20,100}$/.test(siteKey)));
  return { enabled, configured, siteKey: enabled && configured ? siteKey! : null };
}
