import { AuthShell } from "@/features/auth/auth-shell";
import { getMessages } from "@/i18n/messages";
export default function AccessDeniedPage() { const copy = getMessages("ru").auth; return <AuthShell title={copy.deniedTitle}><p>{copy.deniedText}</p></AuthShell>; }
