import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { TeamJoin } from "@/features/team/join";
import { getIdentity } from "@/server/auth/session";
import { openInvitation } from "@/server/team/invitation-envelope";
import { authConfig } from "@/server/supabase/config";
import { teamFoundationEnabled } from "@/server/team/capabilities";
export const dynamic="force-dynamic";
export default async function JoinPage() {
  if (!teamFoundationEnabled()) notFound();
  const identity=await getIdentity();
  const hasPending=Boolean(openInvitation((await cookies()).get("team-invitation")?.value,authConfig().AUTH_FLOW_SECRET));
  return <main id="main-content" className="py-12"><Container><Card><h1 className="mb-5 text-3xl font-semibold">Приглашение в командную диагностику</h1><TeamJoin signedIn={Boolean(identity?.user.email_confirmed_at)} hasPending={hasPending} /></Card></Container></main>;
}
