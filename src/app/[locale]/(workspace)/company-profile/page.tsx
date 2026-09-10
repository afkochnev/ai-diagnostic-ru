import { AuthShell } from "@/features/auth/auth-shell";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { requireIdentity } from "@/server/auth/session";
import { getOwnCompany, getReferenceData } from "@/server/company/queries";
import { saveCompanyProfileAction } from "@/server/company/actions";
import { getMessages } from "@/i18n/messages";

export default async function CompanyProfilePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const identity = await requireIdentity();
  const [{ industries, revenues }, company, { returnTo }] = await Promise.all([getReferenceData(), getOwnCompany(identity.user.id), searchParams]);
  const copy = getMessages("ru").company;
  return <AuthShell title={company ? copy.editTitle : copy.title}><p className="mb-7 text-muted">{copy.intro}</p><CompanyProfileForm action={saveCompanyProfileAction} company={company} industries={industries} revenues={revenues} returnTo={returnTo === "/ru/dashboard" ? returnTo : "/ru/dashboard"} /></AuthShell>;
}
