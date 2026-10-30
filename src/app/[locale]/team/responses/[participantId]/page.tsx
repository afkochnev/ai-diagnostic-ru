import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireIdentity } from "@/server/auth/session";
import { participantResponse } from "@/server/team/service";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { TeamResponseForm } from "@/features/team/response-form";
import { Container } from "@/components/ui/container";
import { getParticipantResult } from "@/server/team/participant-result-service";
export const dynamic="force-dynamic";
export default async function ResponsePage({ params }: { params: Promise<{participantId:string}> }) {
  if (!teamFoundationEnabled()) notFound();
  await requireIdentity();
  const { participantId }=await params;
  if (!z.uuid().safeParse(participantId).success) notFound();
  let result;
  try { result=await getParticipantResult(participantId); }
  catch(error) {
    const code=error instanceof Error ? error.message : "";
    if(code!=="team_result_incomplete") {
      if(code==="team_response_unavailable" || code==="team_result_unavailable") notFound();
      throw error;
    }
  }
  if(result) redirect(`/ru/team/responses/${participantId}/result`);
  const response=await participantResponse(participantId).catch(()=>null);
  if (!response) notFound();
  return <main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">{response.title}</h1><p className="mb-8 mt-4 text-muted">{response.display_name}, это ваша личная анкета. Владелец компании увидит только статус прохождения. Ответы сохраняются автоматически. Перед уходом убедитесь, что появилось сообщение о сохранении.</p><TeamResponseForm key={response.participant_id} response={response} /></Container></main>;
}
