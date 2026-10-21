import 'server-only';
import {createAdminClient} from '@/server-runtime/supabase/admin';
import {createAuthClient} from '@/server/supabase/server';
import {cookieContext} from './context';
import {acquisitionEnabled} from './contracts';
import type {SessionView} from './contracts';
// Keep the draft schema separate from generated accepted DB types until rollout.
type RpcClient={rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:{message:string}|null}>};
export async function sessionRpc<T>(operation:string,id:string,secretHash:string,payload:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await (createAdminClient() as unknown as RpcClient).rpc('acquisition_session',{p_operation:operation,p_id:id,p_secret_hash:secretHash,p_payload:payload});
 if(error)throw Error(error.message.startsWith('acquisition_')?error.message:'acquisition_unavailable');return data as T;
}
export async function ownSession(){const c=await cookieContext();return sessionRpc<SessionView>('read',c.id,c.hash);}
export async function claimRpc<T>(id:string,secretHash:string|null,mode:string,companyId:string|null=null,accountId:string|null=null):Promise<T>{
 const {data,error}=await (await createAuthClient() as unknown as RpcClient).rpc('claim_anonymous_diagnostic',{p_session_id:id,p_secret_hash:secretHash,p_mode:mode,p_company_id:companyId,p_account_id:accountId});
 if(error)throw Error(error.message);return data as T;
}
export type ClaimResult={status:'claimed'|'claim_pending'|'selection_required';diagnostic_id?:string};
export type Choices={new_user:boolean;draft_name:string;companies:{id:string;name:string;account_id:string}[];accounts:{id:string;name:string;can_create:boolean}[]};
export async function trackInteraction(name:string,companyId:string,diagnosticId:string|null=null,surface='individual_report'){
 const {error}=await (await createAuthClient() as unknown as RpcClient).rpc('record_acquisition_interaction',{p_name:name,p_company_id:companyId,p_diagnostic_id:diagnosticId,p_surface:surface});
 if(error)throw Error('acquisition_event_unavailable');
}
export async function deliveryMilestone(kind:'invitation'|'pdf',entityId:string,userId:string|null=null){
 if(!acquisitionEnabled())return;
 try{const {error}=await (createAdminClient() as unknown as RpcClient).rpc('acquisition_delivery_milestone',{p_kind:kind,p_entity_id:entityId,p_user_id:userId});
  if(error)throw Error('unavailable');
 }catch{console.warn('[acquisition]',{event:'delivery_milestone_unavailable',kind});}
}
export async function conversionContinuation(accountId:string){
 const {data,error}=await (await createAuthClient() as unknown as RpcClient).rpc('read_acquisition_continuation',{p_account_id:accountId});
 if(error)throw Error('acquisition_continuation_unavailable');return typeof data==='string'?data:null;
}
