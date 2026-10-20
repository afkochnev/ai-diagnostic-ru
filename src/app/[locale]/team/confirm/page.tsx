import {notFound} from "next/navigation";
import {Container} from "@/components/ui/container";
import {Card} from "@/components/ui/card";
import {teamFoundationEnabled} from "@/server/team/capabilities";
import {TeamEmailConfirm} from "@/features/team/email-confirm";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default function TeamConfirmPage(){
  if(!teamFoundationEnabled())notFound();
  return <main id="main-content" className="py-12"><Container><Card><h1 className="mb-5 text-3xl font-semibold">Продолжить командную диагностику</h1><TeamEmailConfirm/></Card></Container></main>;
}
