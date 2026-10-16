import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { TeamJoin } from "@/features/team/join";
import { getIdentity } from "@/server/auth/session";
import { openInvitation } from "@/server/team/invitation-envelope";
import { authConfig } from "@/server/supabase/config";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { createHash } from "node:crypto";
import { openTeamChallenge } from "@/server/team/passwordless-challenge";
import { registrationPolicy } from "@/server/auth/legal";
export const dynamic="force-dynamic";
export default async function JoinPage() {
  if (!teamFoundationEnabled()) notFound();
  const identity=await getIdentity();
  const jar=await cookies(), secret=authConfig().AUTH_FLOW_SECRET;
  const token=openInvitation(jar.get("team-invitation")?.value,secret);
  const pendingCode=Boolean(token && openTeamChallenge(jar.get("team-email-challenge")?.value,createHash("sha256").update(token).digest("hex"),secret));
  return <main id="main-content" className="py-12"><Container><Card><h1 className="mb-5 text-3xl font-semibold">Приглашение в командную диагностику</h1><TeamJoin currentEmail={identity?.user.email ?? null} emailConfirmed={Boolean(identity?.user.email_confirmed_at)} hasPending={Boolean(token)} policy={await registrationPolicy()} pendingCode={pendingCode} /></Card></Container></main>;
}
