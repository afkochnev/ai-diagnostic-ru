import { notFound } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { getMessages } from "@/i18n/messages";
export default async function LegalPage({ params }: { params: Promise<{ document: string }> }) {
 const { document } = await params;
 if (!["data-processing", "marketing"].includes(document)) notFound();
 const copy = getMessages("ru").auth;
 return <AuthShell title={document === "marketing" ? copy.marketingLink : copy.dataLink}><p>{copy.temporaryLegal}</p><Link className="mt-5 block underline" href="/ru/register">{copy.registerTitle}</Link></AuthShell>;
}
