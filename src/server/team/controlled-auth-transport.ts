import {assertControlledTeamEffectWindow,assertControlledTeamWindow,controlledTeamMillisecondsRemaining,controlledTeamPersonalMillisecondsRemaining,type ControlledTeamEffect,type ControlledTeamContext,type ControlledTeamW2Verification} from '@/server-runtime/team-smoke';
import type {ControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';

/** One actual Auth dispatch after a durable reservation. Even an SDK retry or
 * unexpected request is refused locally before it reaches the network. */
export function controlledTeamAuthFetch(effect:ControlledTeamEffect,invitationHash:string,fetchImpl:typeof fetch=globalThis.fetch):typeof fetch {
 if(!effect.participant_id||!effect.recipient_email||effect.invitation_hash!==invitationHash)throw Error('controlled_team_unavailable');
 let dispatched=false;
 return async(input,init)=>{
  assertControlledTeamEffectWindow(effect);
  if(dispatched)throw Error('controlled_team_auth_dispatch_spent');
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
  dispatched=true;
  return fetchImpl(request,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,controlledTeamMillisecondsRemaining(effect)))))});
 };
}

/** W2 verification is one real consent-gated request. Failed or ambiguous HTTP
 * still consumes the durable verification row; SDK retries cannot hit the wire. */
export function controlledTeamW2VerifyFetch(context:ControlledTeamContext,verification:ControlledTeamW2Verification,proof:ControlledTeamW2Proof,fetchImpl:typeof fetch=globalThis.fetch):typeof fetch{
 if(!context.window_id||context.window_id!==proof.windowId||verification.window_id!==proof.windowId||context.run_id!==proof.runId||verification.run_id!==proof.runId||verification.participant_id!==proof.participantId||verification.user_id!==proof.userId||verification.invitation_hash!==proof.invitationHash)throw Error('controlled_team_unavailable');
 let dispatched=false;
 return async(input,init)=>{
  assertControlledTeamWindow(context);
  const personal=controlledTeamPersonalMillisecondsRemaining(context);
  if(dispatched)throw Error('controlled_team_auth_dispatch_spent');
  if(!Number.isFinite(personal)||personal<=0||proof.expires<=Date.now())throw Error('controlled_team_unavailable');
  const request=new Request(input,init),url=new URL(request.url);
  if(request.method!=='POST'||url.origin!=='https://fhvxqeaujjeiflanqsbg.supabase.co'||url.pathname!=='/auth/v1/verify'||url.search||url.hash||url.username||url.password)throw Error('controlled_team_auth_scope');
  const raw=await request.clone().text();if(raw.length>2048)throw Error('controlled_team_auth_scope');
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{throw Error('controlled_team_auth_scope');}
  const security=body?.gotrue_meta_security;
  if(!body||Array.isArray(body)||body.type!=='magiclink'||body.token_hash!==proof.tokenHash||Object.keys(body).some(k=>!['type','token_hash','gotrue_meta_security'].includes(k))||security!==undefined&&(!security||typeof security!=='object'||Array.isArray(security)||Object.keys(security).length!==0))throw Error('controlled_team_auth_scope');
  dispatched=true;
  return fetchImpl(request,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,personal,proof.expires-Date.now(),controlledTeamMillisecondsRemaining(context)))))});
 };
}
