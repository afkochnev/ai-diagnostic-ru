// Node/server only. Construction is explicit; imports read no environment.
import {serviceConfig} from './supabase/config';
import {deriveEvidenceChannelKey,evidenceChannelHeader,evidenceKeyContext,type EvidenceKeyContext} from '@/server/team/evidence-channel-key';

const unavailable=()=>Error('controlled_team_evidence_unavailable');
const projects=new Map([
 ['https://fhvxqeaujjeiflanqsbg.supabase.co','https://audit.iteam.ru'],
 ['https://vflgxgdwlftlyjslyrmo.supabase.co','https://ai-diagnostic-staging-web.onrender.com'],
]);
export function runtimeEvidenceKeyContext(rootRunId:string,approvedPlanSHA256:string,env:Record<string,string|undefined>=process.env):EvidenceKeyContext{
 return evidenceKeyContext({domain:'aca-w2-evidence-key',version:1,rootRunId,approvedPlanSHA256,canonicalAppSHA:env.RENDER_GIT_COMMIT});
}
/** Same derivation for deployed web and controlled one-off Node execution.
 * The existing Render build SHA must match the independently pinned context. */
export function createRuntimeEvidenceChannel(contextValue:EvidenceKeyContext,env:Record<string,string|undefined>=process.env){
 const context=evidenceKeyContext(contextValue);
 if(context.canonicalAppSHA!==env.RENDER_GIT_COMMIT||!env.SUPABASE_URL||projects.get(env.SUPABASE_URL)!==env.APP_URL)throw unavailable();
 return Object.freeze({context,key:deriveEvidenceChannelKey(env.AUTH_FLOW_SECRET as string,context)});
}
export function createRuntimeEvidenceRPC(contextValue:EvidenceKeyContext){
 const c=serviceConfig(),{key}=createRuntimeEvidenceChannel(contextValue);
 if(c.SUPABASE_URL!=='https://fhvxqeaujjeiflanqsbg.supabase.co')throw unavailable();
 const names=new Set(['check_controlled_team_auth_evidence_key','begin_controlled_team_auth_wire','finish_controlled_team_auth_wire']);
 return Object.freeze({key,async rpc(name:string,args:Record<string,unknown>){
  if(!names.has(name))throw unavailable();
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([(async()=>{
   const response=await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{Authorization:'Bearer '+c.SUPABASE_SERVICE_ROLE_KEY,apikey:c.SUPABASE_SERVICE_ROLE_KEY,'x-aca-w2-evidence-key':evidenceChannelHeader(key),'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok||response.redirected)throw unavailable();
   const maximum=65536,declared=response.headers.get('content-length');
   if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum)||!response.body)throw unavailable();
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
   try{for(;;){const next=await reader.read();if(controller.signal.aborted)throw unavailable();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maximum)throw unavailable();chunks.push(next.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
   finally{controller.signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},5000);})]);}
  catch{controller.abort();throw unavailable();}finally{clearTimeout(timer);}
 }});
}
