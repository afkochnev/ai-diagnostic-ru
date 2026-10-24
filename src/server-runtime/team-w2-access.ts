// Standalone, credential-safe operator boundary. Never exposed as a server
// action, owner route, public CLI default or automatic recovery mechanism.
import {z} from 'zod';
import {createAdminClient} from './supabase/admin';
import {authConfig} from './supabase/config';
import {controlledTeamContext,reserveControlledTeamW2Access,completeControlledTeamEffect,assertControlledTeamEffectWindow} from './team-smoke';
import {sealControlledTeamW2Proof} from './team-w2-proof';
import {controlledTeamAuthFetch} from '@/server/team/controlled-auth-transport';
import {sendControlledTeamW2AccessEmail} from '@/server/team/invitation-email';
import {createAuthWireEvidence} from './team-auth-evidence';

/** This function consumes the two NEW W2 durable slots for one exact pending
 * identity. Re-entry after any reserved dispatch fails; it cannot reset R's
 * historical reservations, issue a new invite/UID or rotate its database hash. */
export async function recoverControlledTeamAccess(input:{windowId:string;participantId:string}){
 const {windowId,participantId}=z.object({windowId:z.uuid(),participantId:z.uuid()}).strict().parse(input);
 const config=authConfig();
 const context=await controlledTeamContext({windowId,participantId});
 if(!context?.window_id||!context.team_id||!context.personal_deadline_at)throw Error('controlled_team_unavailable');
 const effect=await reserveControlledTeamW2Access(context,participantId,'reauth_link');
 let dispatched=false,completed=false;
 try{
  assertControlledTeamEffectWindow(effect);
  const evidence=createAuthWireEvidence({runId:context.run_id,windowId,participantId,userId:effect.user_id,operation:'issue',reservationId:effect.reservation_id,planHash:context.approved_plan_hash??''});
  const admin=createAdminClient(controlledTeamAuthFetch(effect,effect.invitation_hash,globalThis.fetch,evidence));
  dispatched=true;
  const {data,error}=await admin.auth.admin.generateLink({type:'magiclink',email:effect.recipient_email,options:{redirectTo:`${config.APP_URL}/ru/team/join`}});
  if(error||data?.user?.id!==effect.user_id||data.user.email?.toLowerCase()!==effect.recipient_email||data.properties?.verification_type!=='magiclink'||!z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).safeParse(data.properties.hashed_token).success)throw Error('controlled_team_access_unconfirmed');
  const proof=sealControlledTeamW2Proof({runId:context.run_id,windowId,teamId:context.team_id,participantId,userId:effect.user_id,email:effect.recipient_email,invitationHash:effect.invitation_hash,tokenHash:data.properties.hashed_token,type:'magiclink'},config.AUTH_FLOW_SECRET,Math.min(Date.parse(context.expires_at),Date.parse(context.personal_deadline_at)));
  await completeControlledTeamEffect(effect,'succeeded');
  completed=true;
  // Proof exists only in process memory and the recipient's one encrypted link.
  // No credential is persisted to artifacts or returned to the operator.
  await sendControlledTeamW2AccessEmail(context,effect,`${config.APP_URL}/ru/team/join#access=${proof}`);
  return {windowId,participantId,status:'succeeded' as const};
 }catch{
  // A successful issuance is already immutable: the SQL completion RPC refuses
  // any rewrite if a subsequent email failed. Unknown always remains spent.
  if(!completed)await completeControlledTeamEffect(effect,dispatched?'unknown':'failed').catch(()=>{});
  throw Error('controlled_team_access_unconfirmed');
 }
}
