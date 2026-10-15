import { notFound } from "next/navigation";
import { z } from "zod";
import { requireIdentity } from "@/server/auth/session";
import { requireCompanyRoute } from "@/features/company/company-route";
import { CompanyNavigation } from "@/features/company/company-navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { InviteTeamForm } from "@/features/team/owner-forms";
import { ownerTeam } from "@/server/team/service";
import { revokeTeamAction } from "@/server/team/actions";
import { teamFoundationEnabled } from "@/server/team/capabilities";
export default async function TeamPage({ params }: { params: Promise<{companyId:string;teamId:string}> }) {
  if (!teamFoundationEnabled()) notFound();
  const identity = await requireIdentity(), {companyId,teamId} = await params;
  if (!z.uuid().safeParse(teamId).success) notFound();
  await requireCompanyRoute(companyId,identity.user.id);
  const record = await ownerTeam(teamId);
  if (!record || record.team.company_id!==companyId) notFound();
  const labels:Record<string,string>={invited:"Приглашён",started:"Начал",completed:"Завершил"};
  return <><CompanyNavigation companyId={companyId} userId={identity.user.id} /><main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">{record.team.title}</h1><p className="mt-4 text-muted">Индивидуальные ответы конфиденциальны. Здесь доступны только участники и статусы прохождения.</p><Card className="mt-6"><h2 className="mb-4 text-xl font-semibold">Пригласить участника</h2><InviteTeamForm key={teamId} teamId={teamId} /></Card><section className="mt-8"><h2 className="text-2xl font-semibold">Участники</h2>{record.participants.length ? <ul className="mt-4 space-y-4">{record.participants.map((p) => <li key={p.id}><Card><p className="font-semibold">{p.display_name}</p><p className="mt-1 break-words text-sm">{p.email}</p><p className="mt-3">{p.revoked_at ? "Приглашение отозвано" : labels[p.status]}</p>{!p.revoked_at && <details className="mt-4"><summary className="cursor-pointer text-sm underline">Управление приглашением</summary><InviteTeamForm teamId={teamId} participantId={p.id} /><form action={revokeTeamAction} className="mt-4"><input type="hidden" name="participantId" value={p.id} /><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="companyId" value={companyId} /><button className="text-sm text-red-800 underline">Отозвать доступ участника</button></form></details>}</Card></li>)}</ul> : <p className="mt-4">Участники ещё не приглашены.</p>}</section></Container></main></>;
}
