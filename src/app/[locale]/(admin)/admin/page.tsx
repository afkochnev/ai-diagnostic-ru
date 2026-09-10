import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { AuthShell } from "@/features/auth/auth-shell";
import { getMessages } from "@/i18n/messages";
export default async function AdminEntry() {
 const identity = await requireIdentity();
 if (identity.role !== "administrator") redirect("/ru/access-denied");
 const copy = getMessages("ru").auth;
 return <AuthShell title={copy.adminEntryTitle}><p>{copy.adminEntryText}</p></AuthShell>;
}
