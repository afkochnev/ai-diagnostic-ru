import "server-only";
import {createHash} from "node:crypto";
import {cookies,headers} from "next/headers";
import {z} from "zod";
import {createAdminClient} from "@/server-runtime/supabase/admin";
import {authConfig} from "@/server/supabase/config";
import {teamFoundationEnabled} from "./capabilities";
import {openInvitationContext} from "./invitation-envelope";
import {openInvitationDetails,maskTeamEmail} from "./invitation-details";
import {openTeamChallenge} from "./passwordless-challenge";
import {openInvitationAuthProof} from "./invitation-auth-proof";
import {controlledTeamContext,controlledTeamRequired} from '@/server-runtime/team-smoke';
import {readControlledTeamW2Entry} from './w2-entry';
const targetSchema=z.object({email:z.email().max(254),display_name:z.string().min(1).max(100),create_user:z.boolean()}).strict();
export async function teamEntryContext(checkOrigin=false){
  if(!teamFoundationEnabled())throw new Error("team_auth_unavailable");
  if(checkOrigin && (await headers()).get("origin")!==authConfig().APP_URL)throw new Error("team_auth_unavailable");
  const jar=await cookies(),secret=authConfig().AUTH_FLOW_SECRET;
  const w2Envelope=jar.get('team-w2-access')?.value;
  if(w2Envelope){
   const entry=await readControlledTeamW2Entry(w2Envelope,secret);
   return {jar,secret,token:'',hash:entry.proof.invitationHash,target:entry.target,details:null,challenge:null,proof:entry.proof,w2:entry,expires:entry.proof.expires,flowId:createHash('sha256').update(w2Envelope).digest('hex').slice(0,16)};
  }
  const envelope=jar.get("team-invitation")?.value;
  const invitation=openInvitationContext(envelope,secret);
  if(!invitation)throw new Error("team_context_expired");
  const hash=createHash("sha256").update(invitation.token).digest("hex");
  const controlled=await controlledTeamContext({invitationHash:hash});
  // An old invite/credential cannot be resealed or admitted into a new window.
  if(controlled?.window_id)throw Error('team_context_expired');
  const {data,error}=await createAdminClient().rpc("resolve_team_invitation_auth",{p_token_hash:hash});
  if(error)throw new Error("team_invitation_unavailable");
  const target=targetSchema.parse(data),encodedDetails=jar.get("team-invitation-details")?.value;
  const details=openInvitationDetails(encodedDetails,hash,secret);
  if(encodedDetails && (!details || details.email!==target.email))throw new Error("team_invitation_unavailable");
  const challenge=openTeamChallenge(jar.get("team-email-challenge")?.value,hash,secret);
  const encodedProof=jar.get("team-invitation-auth")?.value;
  const proof=openInvitationAuthProof(encodedProof,hash,secret);
  if(encodedProof && (!proof || proof.email!==target.email))throw new Error("team_context_expired");
  if(controlledTeamRequired()&&!proof)throw Error('team_context_expired');
  return {jar,secret,token:invitation.token,hash,target,details,challenge,proof,expires:proof?Math.min(invitation.expires,proof.expires):invitation.expires,flowId:createHash("sha256").update(envelope!).digest("hex").slice(0,16)};
}
export async function clearTeamEntry(){
  const jar=await cookies();
  for(const name of ["team-invitation","team-invitation-details","team-email-challenge","team-invitation-auth","team-w2-access"]){
    jar.set(name,"",{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:name==="team-email-challenge" || name==="team-invitation-auth" || name==='team-w2-access'?"/ru/team":"/ru",maxAge:0});
  }
}
export type TeamEntryView={phase:"ready"|"waiting"|"expired";company?:string;team?:string;inviter?:string;maskedEmail?:string;flowId?:string;expires?:number;sentAt?:number;codeExpires?:number;matching?:boolean;wrongAccount?:boolean;singleEmail?:boolean;continuation?:boolean};
export async function teamEntryView(currentEmail:string|null,confirmed:boolean):Promise<TeamEntryView>{
  try{
    const c=await teamEntryContext();
    return {phase:c.challenge?"waiting":"ready",company:c.details?.company??"Компания из вашего приглашения",team:c.details?.team??"Командная диагностика",inviter:c.details?.inviter??"Организатор",maskedEmail:maskTeamEmail(c.target.email),flowId:c.flowId,expires:c.expires,singleEmail:Boolean(c.proof),continuation:'w2' in c,...(c.challenge?{sentAt:c.challenge.expires-600000,codeExpires:c.challenge.expires}:{}),matching:confirmed && currentEmail?.toLowerCase()===c.target.email,wrongAccount:Boolean(currentEmail && currentEmail.toLowerCase()!==c.target.email)};
  }catch{const jar=await cookies();return {phase:"expired",singleEmail:Boolean(jar.get("team-invitation-auth")?.value||jar.get('team-w2-access')?.value),continuation:Boolean(jar.get('team-w2-access')?.value)};}
}
