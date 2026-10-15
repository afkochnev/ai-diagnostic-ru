import { CompanyNavigation } from "./company-navigation";
import { requireIdentity } from "@/server/auth/session";
import { AuthShell } from "@/features/auth/auth-shell";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { getReferenceData, type getOwnCompany } from "@/server/company/queries";
import { createCompanyProfileAction, saveCompanyProfileAction } from "@/server/company/actions";
import { getMessages } from "@/i18n/messages";

type Company = Awaited<ReturnType<typeof getOwnCompany>> | null;

export async function CompanyProfileEditor({ company, accountId, creationSource }: { company: Company; accountId: string; creationSource?: string | null }) {
  const { industries, revenues } = await getReferenceData();
  const copy = getMessages("ru").company;
  const action = creationSource === undefined ? saveCompanyProfileAction : createCompanyProfileAction.bind(null, creationSource);
  return <>{company && <CompanyNavigation companyId={company.id} userId={(await requireIdentity()).user.id} />}<AuthShell title={company ? copy.editTitle : "Добавьте вашу компанию"}><p className="mb-7 text-muted">{copy.intro}</p><CompanyProfileForm action={action} company={company} accountId={accountId} industries={industries} revenues={revenues} returnTo={company ? `/ru/companies/${company.id}` : "/ru/dashboard"} /></AuthShell></>;
}
