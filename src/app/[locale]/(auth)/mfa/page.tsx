import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/auth-shell";
import { MfaForm } from "@/features/auth/mfa-form";
import { getIdentity } from "@/server/auth/session";
import { createAuthClient } from "@/server/supabase/server";
import { getMessages } from "@/i18n/messages";
export default async function MfaPage() {
 const identity = await getIdentity();
 if (!identity) redirect("/ru/login");
 if (!identity.user.email_confirmed_at) redirect("/ru/verify-email");
 if (identity.role !== "administrator") redirect("/ru/access-denied");
 if (identity.aal === "aal2") redirect("/ru/account");
 const { data } = await (await createAuthClient()).auth.mfa.listFactors();
 const factor = data?.totp.find((item) => item.status === "verified");
 return <AuthShell title={getMessages("ru").auth.mfaTitle}><MfaForm factorId={factor?.id} /></AuthShell>;
}
