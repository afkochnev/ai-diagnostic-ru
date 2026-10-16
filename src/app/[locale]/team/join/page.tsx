import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { TeamJoin } from "@/features/team/join";
import { getIdentity } from "@/server/auth/session";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { teamEntryView } from "@/server/team/entry-context";
import { registrationPolicy } from "@/server/auth/legal";
export const dynamic="force-dynamic";
export default async function JoinPage() {
  if (!teamFoundationEnabled()) notFound();
  const identity=await getIdentity();
  const view=await teamEntryView(identity?.user.email??null,Boolean(identity?.user.email_confirmed_at));
  return <main id="main-content" className="py-12"><Container><Card><h1 className="mb-5 text-3xl font-semibold">Вас пригласили пройти командную диагностику</h1><TeamJoin view={view} policy={await registrationPolicy()} /></Card></Container></main>;
}
