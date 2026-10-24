import {assertControlledTeamEffectWindow,assertControlledTeamWindow,controlledTeamMillisecondsRemaining,controlledTeamPersonalMillisecondsRemaining,type ControlledTeamEffect,type ControlledTeamContext,type ControlledTeamW2Verification} from '@/server-runtime/team-smoke';
import type {ControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';
import {createAuthWireEvidence} from '@/server-runtime/team-auth-evidence';
import {readAuthWireJSON,type AuthWireEvidence} from './auth-wire-contract';

/** The durable trace is committed before the one actual HTTP request. The
 * recorded interval brackets fetch itself, rather than an RPC/job/browser action.
 * A trace write with unknown outcome is never attempted a second time. */
async function observedAuthFetch(request:Request,fetchImpl:typeof fetch,evidence:AuthWireEvidence,scope:{operation:'issue'|'verify';userId:string;email:string;tokenHash:string|null;assert:()=>void;timeout:()=>number}){
 await evidence.begin(scope.tokenHash);
 const controller=new AbortController();
 let response:Response|undefined,dispatchedAt:string|null=null,receivedAt:string|null=null,finishAttempted=false,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  scope.assert();
  const milliseconds=Math.floor(scope.timeout());
  if(!Number.isFinite(milliseconds)||milliseconds<=0)throw Error('controlled_team_unavailable');
  let tokenHash=scope.tokenHash,responseIdentityMatches=false;
  try{
   dispatchedAt=new Date().toISOString();
   await Promise.race([(async()=>{
    response=await fetchImpl(request,{redirect:'error',cache:'no-store',signal:controller.signal});
    receivedAt=new Date().toISOString();
    if(!(response instanceof Response)||response.redirected||response.status<100||response.status>599)throw Error('invalid_response');
    if(!response.ok)return;
    const value=await readAuthWireJSON(response) as {id?:unknown;email?:unknown;verification_type?:unknown;hashed_token?:unknown;user?:{id?:unknown;email?:unknown;email_confirmed_at?:unknown}};
    if(scope.operation==='issue'){
     responseIdentityMatches=value?.id===scope.userId&&typeof value.email==='string'&&value.email.toLowerCase()===scope.email&&value.verification_type==='magiclink'&&typeof value.hashed_token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(value.hashed_token);
     if(responseIdentityMatches)tokenHash=value.hashed_token as string;
    }else responseIdentityMatches=value?.user?.id===scope.userId&&typeof value.user.email==='string'&&value.user.email.toLowerCase()===scope.email&&typeof value.user.email_confirmed_at==='string'&&Number.isFinite(Date.parse(value.user.email_confirmed_at));
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('bounded_auth_timeout'));},milliseconds);})]);
  }finally{clearTimeout(timer);}
  const succeeded=response?.ok===true&&responseIdentityMatches;
  finishAttempted=true;
  await evidence.finish({dispatchedAt,receivedAt,httpStatus:response?.status??null,outcome:succeeded?'succeeded':'failed',tokenHash,responseIdentityMatches});
  if(!succeeded||!response)throw Error('controlled_team_auth_evidence_unavailable');
  return response;
 }catch{
  if(!finishAttempted){
   finishAttempted=true;
   await evidence.finish({dispatchedAt,receivedAt,httpStatus:response&&response.status>=100?response.status:null,outcome:dispatchedAt===null?'failed':'unknown',tokenHash:null,responseIdentityMatches:false}).catch(()=>{});
  }
  throw Error('controlled_team_auth_evidence_unavailable');
 }
}

/** One actual Auth dispatch after a durable reservation. Even an SDK retry or
 * unexpected request is refused locally before it reaches the network. */
export function controlledTeamAuthFetch(effect:ControlledTeamEffect,invitationHash:string,fetchImpl:typeof fetch=globalThis.fetch,evidence?:AuthWireEvidence):typeof fetch {
 if(!effect.participant_id||!effect.recipient_email||effect.invitation_hash!==invitationHash)throw Error('controlled_team_unavailable');
 let dispatched=false;
 return async(input,init)=>{
  assertControlledTeamEffectWindow(effect);
  if(dispatched)throw Error('controlled_team_auth_dispatch_spent');
  // Claim synchronously, before any body-read/RPC await, including concurrent calls.
  dispatched=true;
  const request=new Request(input,init),url=new URL(request.url);
  if(request.method!=='POST'||url.origin!=='https://fhvxqeaujjeiflanqsbg.supabase.co'||url.pathname!=='/auth/v1/admin/generate_link'||url.hash||url.username||url.password||[...url.searchParams.keys()].join(',')!=='redirect_to'||url.searchParams.get('redirect_to')!=='https://audit.iteam.ru/ru/team/join')throw Error('controlled_team_auth_scope');
  const raw=await request.clone().text();
  if(raw.length>10000)throw Error('controlled_team_auth_scope');
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);}catch{throw Error('controlled_team_auth_scope');}
  if(!body||Array.isArray(body)||body.email!==effect.recipient_email||!['invite','magiclink'].includes(String(body.type))||body.redirectTo!=='https://audit.iteam.ru/ru/team/join'||Object.keys(body).some(k=>!['type','email','redirectTo','data'].includes(k)))throw Error('controlled_team_auth_scope');
  if(effect.window_id&&body.type!=='magiclink')throw Error('controlled_team_auth_scope');
  if(body.type==='invite'){
   const data=body.data as Record<string,unknown>|undefined;
   if(!data||Object.keys(data).join(',')!=='team_pending_nonce'||typeof data.team_pending_nonce!=='string'||!/^[a-f0-9]{64}$/.test(data.team_pending_nonce))throw Error('controlled_team_auth_scope');
  }else if(body.data!==undefined)throw Error('controlled_team_auth_scope');
  assertControlledTeamEffectWindow(effect);
  if(effect.window_id){
   const userId=(effect as ControlledTeamEffect&{user_id?:string}).user_id;
   if(!evidence||!userId)throw Error('controlled_team_auth_evidence_unavailable');
   return observedAuthFetch(request,fetchImpl,evidence,{operation:'issue',userId,email:effect.recipient_email!,tokenHash:null,assert:()=>assertControlledTeamEffectWindow(effect),timeout:()=>Math.min(15000,controlledTeamMillisecondsRemaining(effect))});
  }
  return fetchImpl(request,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,controlledTeamMillisecondsRemaining(effect)))))});
 };
}

/** W2 verification is one real consent-gated request. Failed or ambiguous HTTP
 * still consumes the durable verification row; SDK retries cannot hit the wire. */
export function controlledTeamW2VerifyFetch(context:ControlledTeamContext,verification:ControlledTeamW2Verification,proof:ControlledTeamW2Proof,fetchImpl:typeof fetch=globalThis.fetch,evidence?:AuthWireEvidence):typeof fetch{
 if(!context.window_id||context.window_id!==proof.windowId||verification.window_id!==proof.windowId||context.run_id!==proof.runId||verification.run_id!==proof.runId||verification.participant_id!==proof.participantId||verification.user_id!==proof.userId||verification.invitation_hash!==proof.invitationHash)throw Error('controlled_team_unavailable');
 let dispatched=false;
 return async(input,init)=>{
  assertControlledTeamWindow(context);
  const personal=controlledTeamPersonalMillisecondsRemaining(context);
  if(dispatched)throw Error('controlled_team_auth_dispatch_spent');
  dispatched=true;
  if(!Number.isFinite(personal)||personal<=0||proof.expires<=Date.now())throw Error('controlled_team_unavailable');
  const request=new Request(input,init),url=new URL(request.url);
  if(request.method!=='POST'||url.origin!=='https://fhvxqeaujjeiflanqsbg.supabase.co'||url.pathname!=='/auth/v1/verify'||url.search||url.hash||url.username||url.password)throw Error('controlled_team_auth_scope');
  const raw=await request.clone().text();if(raw.length>2048)throw Error('controlled_team_auth_scope');
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{throw Error('controlled_team_auth_scope');}
  const security=body?.gotrue_meta_security;
  if(!body||Array.isArray(body)||body.type!=='magiclink'||body.token_hash!==proof.tokenHash||Object.keys(body).some(k=>!['type','token_hash','gotrue_meta_security'].includes(k))||security!==undefined&&(!security||typeof security!=='object'||Array.isArray(security)||Object.keys(security).length!==0))throw Error('controlled_team_auth_scope');
  const trace=evidence??createAuthWireEvidence({runId:proof.runId,windowId:proof.windowId,participantId:proof.participantId,userId:proof.userId,operation:'verify',reservationId:verification.verification_id,planHash:context.approved_plan_hash??''});
  return observedAuthFetch(request,fetchImpl,trace,{operation:'verify',userId:proof.userId,email:proof.email,tokenHash:proof.tokenHash,assert:()=>{assertControlledTeamWindow(context);if(controlledTeamPersonalMillisecondsRemaining(context)<=0||proof.expires<=Date.now())throw Error('controlled_team_unavailable');},timeout:()=>Math.min(15000,controlledTeamPersonalMillisecondsRemaining(context),proof.expires-Date.now(),controlledTeamMillisecondsRemaining(context))});
 };
}
