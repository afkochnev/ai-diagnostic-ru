export const PUBLIC_APP_ORIGIN = "https://audit.iteam.ru";
export const PUBLIC_APP_HOSTNAME = new URL(PUBLIC_APP_ORIGIN).hostname;
export const LEGACY_PUBLIC_APP_ORIGIN = "https://audit.iteamsystems.com";
export const PRODUCTION_SUPABASE_URL = "https://fhvxqeaujjeiflanqsbg.supabase.co";

export function isProductionAppOrigin(value: string | undefined): boolean {
  return value === PUBLIC_APP_ORIGIN || value === LEGACY_PUBLIC_APP_ORIGIN;
}
