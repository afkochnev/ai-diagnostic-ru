
import { requestLocale } from "@/server/locale";
import { AuthShell } from "@/features/auth/auth-shell";
import { getMessages } from "@/i18n/messages";
export default async function AccessDeniedPage() {
  const locale = await requestLocale();
 const copy = getMessages(locale).auth; return <AuthShell title={copy.deniedTitle}><p>{copy.deniedText}</p></AuthShell>; }
