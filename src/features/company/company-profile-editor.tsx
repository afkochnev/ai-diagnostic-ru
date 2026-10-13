import { AuthShell } from "@/features/auth/auth-shell";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { getReferenceData, type getOwnCompany } from "@/server/company/queries";
import { saveCompanyProfileAction } from "@/server/company/actions";
import { getMessages } from "@/i18n/messages";

type Company = Awaited<ReturnType<typeof getOwnCompany>> | null;

export async function CompanyProfileEditor({ company, accountId }: { company: Company; accountId: string }) {
  const { industries, revenues } = await getReferenceData();
  const copy = getMessages("ru").company;
  return <AuthShell title={company ? copy.editTitle : copy.title}><p className="mb-7 text-muted">{copy.intro}</p><CompanyProfileForm action={saveCompanyProfileAction} company={company} accountId={accountId} industries={industries} revenues={revenues} returnTo={company ? `/ru/companies/${company.id}` : "/ru/dashboard"} /></AuthShell>;
}
