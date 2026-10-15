import Link from "next/link";
import { notFound } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { requireCompanyRoute } from "@/features/company/company-route";
import { CompanyNavigation } from "@/features/company/company-navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { CreateTeamForm } from "@/features/team/owner-forms";
import { listTeams } from "@/server/team/service";
import { teamFoundationEnabled } from "@/server/team/capabilities";
export default async function TeamsPage({ params }: { params: Promise<{companyId:string}> }) {
  if (!teamFoundationEnabled()) notFound();
  const identity = await requireIdentity(), {companyId} = await params;
  const company = await requireCompanyRoute(companyId,identity.user.id), teams = await listTeams(companyId);
  return <><CompanyNavigation companyId={companyId} userId={identity.user.id} /><main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">Командные диагностики — {company.name}</h1><p className="mt-4 text-muted">Пригласите участников отдельно. Вам будут доступны статусы прохождения, без индивидуальных ответов. Создание диагностики не включает вас в участники.</p><Card className="mt-6"><CreateTeamForm key={companyId} companyId={companyId} /></Card><div className="mt-8 space-y-4">{teams.length ? teams.map((team) => <Card key={team.id}><Link className="text-xl font-semibold underline" href={`/ru/companies/${companyId}/teams/${team.id}`}>{team.title}</Link><p className="mt-2 text-sm text-muted">{new Date(team.created_at).toLocaleDateString("ru-RU")}</p></Card>) : <p>Командных диагностик пока нет.</p>}</div></Container></main></>;
}
