const stagingOrigin = "https://ai-diagnostic-staging-web.onrender.com";
const stagingDatabase = "https://vflgxgdwlftlyjslyrmo.supabase.co";

export function stagingAccessEmailEnabled(sessionId: string, email?: string) {
  if (process.env.APP_URL !== stagingOrigin || process.env.SUPABASE_URL !== stagingDatabase) return false;
  const [allowedSession, allowedEmail] = (process.env.ACQUISITION_STAGING_EMAIL ?? "").split(" ", 2);
  return Boolean(allowedEmail && allowedSession === sessionId && (email === undefined || allowedEmail === email));
}
