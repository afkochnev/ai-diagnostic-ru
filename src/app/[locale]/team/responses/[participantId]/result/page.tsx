import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Container } from "@/components/ui/container";
import { requireIdentity } from "@/server/auth/session";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { getParticipantResult } from "@/server/team/participant-result-service";
import { ParticipantResultView } from "@/features/team/participant-result";

export const dynamic = "force-dynamic";
export default async function ParticipantResultPage({ params }: { params: Promise<{ participantId: string }> }) {
  if (!teamFoundationEnabled()) notFound();
  await requireIdentity();
  const { participantId } = await params;
  if (!z.uuid().safeParse(participantId).success) notFound();
  let result;
  try { result = await getParticipantResult(participantId); }
  catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "team_result_incomplete") redirect(`/ru/team/responses/${participantId}`);
    if (code === "team_response_unavailable" || code === "team_result_unavailable") notFound();
    throw cause;
  }
  return <main id="main-content" className="py-10"><Container><ParticipantResultView result={result} /></Container></main>;
}
