import { CompanyNavigation } from "./company-navigation";
import { requireIdentity } from "@/server/auth/session";
import { AuthShell } from "@/features/auth/auth-shell";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { getReferenceData, type getOwnCompany } from "@/server/company/queries";
import { createCompanyForAccountAction, createCompanyProfileAction, saveCompanyProfileAction } from "@/server/company/actions";
import { getMessages } from "@/i18n/messages";

type Company = Awaited<ReturnType<typeof getOwnCompany>> | null;

export async function CompanyProfileEditor({ company, accountId, creationSource, creationAccountId }: { company: Company; accountId: string; creationSource?: string | null; creationAccountId?: string }) {
  const { industries, revenues } = await getReferenceData();
  const identity = await requireIdentity();
  const copy = getMessages("ru").company;
  const action = creationAccountId ? createCompanyForAccountAction.bind(null, creationAccountId, creationSource ?? null) : creationSource === undefined ? saveCompanyProfileAction : createCompanyProfileAction.bind(null, creationSource);
  return <>{company && <CompanyNavigation companyId={company.id} userId={identity.user.id} />}<AuthShell title={company ? copy.editTitle : "Расскажите о компании"}><p className="mb-7 text-muted">{company ? "Эти сведения помогают учесть контекст компании в отчёте. Дополнительные поля можно оставить пустыми." : "Сначала — шесть сведений о компании, затем — выбор диагностики и вопросы. Проблемы и цели перенесём в вашу анкету, где их можно уточнить."}</p><CompanyProfileForm key={company?.id ?? `new:${accountId}`} action={action} company={company} accountId={accountId} userId={identity.user.id} industries={industries} revenues={revenues} returnTo={company ? `/ru/companies/${company.id}` : "/ru/dashboard"} /></AuthShell></>;
}
