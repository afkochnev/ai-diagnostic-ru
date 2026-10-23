import {assertControlledTeamEffectWindow,controlledTeamMillisecondsRemaining,type ControlledTeamEffect} from '@/server-runtime/team-smoke';

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
  if(body.type==='invite'){
   const data=body.data as Record<string,unknown>|undefined;
   if(!data||Object.keys(data).join(',')!=='team_pending_nonce'||typeof data.team_pending_nonce!=='string'||!/^[a-f0-9]{64}$/.test(data.team_pending_nonce))throw Error('controlled_team_auth_scope');
  }else if(body.data!==undefined)throw Error('controlled_team_auth_scope');
  assertControlledTeamEffectWindow(effect);
  dispatched=true;
  return fetchImpl(request,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,controlledTeamMillisecondsRemaining(effect)))))});
 };
}
