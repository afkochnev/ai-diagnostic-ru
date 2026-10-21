import {acquisitionJson} from '@/server/acquisition/request';
import {getIdentity} from '@/server/auth/session';
import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {guardOrigin,cookieContext,setContext,newSecret,hash,ipLimit,limit,visitCookie} from '@/server/acquisition/context';
import {sessionRpc,trackInteraction,claimRpc,type ClaimResult} from '@/server/acquisition/service';
import {saveSchema,safeAttribution} from '@/server/acquisition/contracts';
import {accessProof} from '@/server/acquisition/email';
import {authConfig} from '@/server/supabase/config';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{operation:string}>}){
 try{await guardOrigin();const {operation}=await params;
  if(Number(request.headers.get('content-length')??0)>300000)return NextResponse.json({error:'invalid'},{status:413});
  const body=await acquisitionJson(request);
  if(operation==='visit'){
   let c;try{c=await cookieContext(visitCookie);}catch{await ipLimit();const secret=newSecret();c={id:randomUUID(),secret,hash:hash(secret)};}
   await limit('visit',c.id,60,3600);await sessionRpc('visit',c.id,c.hash,safeAttribution(z.record(z.string(),z.unknown()).parse(body)));await setContext(visitCookie,c.id,c.secret);
   return NextResponse.json({ok:true});
  }
  if(operation==='cta'){const c=await cookieContext(visitCookie);await sessionRpc('cta',c.id,c.hash);return NextResponse.json({ok:true});}
  if(operation==='access'){
   const parsed=z.object({id:z.uuid(),envelope:z.string().max(2048)}).strict().parse(body);
   // A previously claimed link is a useful bookmark only for its verified owner.
   // The DB receipt path checks the live Auth session and never returns source answers.
   try{const receipt=await claimRpc<ClaimResult>(parsed.id,null,'receipt');if(receipt.status==='claimed'&&receipt.diagnostic_id)return NextResponse.json({ok:true,diagnosticId:receipt.diagnostic_id});}catch{}
   if(!accessProof(parsed.envelope,parsed.id))throw Error('acquisition_expired');
   const jar=await cookies(),options={httpOnly:true,secure:authConfig().secure,sameSite:'lax' as const,path:'/',maxAge:1800};
   jar.set('aca-access',parsed.envelope,options);jar.set('aca-access-id',parsed.id,options);return NextResponse.json({ok:true});
  }
  if(operation==='event'){
   const identity=await getIdentity();if(!identity)throw Error('acquisition_unavailable');await limit('event',identity.user.id,100,600);
   const e=z.object({name:z.enum(['individual_report_viewed','advanced_offer_viewed','team_explainer_viewed']),companyId:z.uuid(),diagnosticId:z.uuid().nullable(),surface:z.enum(['individual_report','dashboard','diagnostics_hub','team_explainer'])}).strict().parse(body);
   await trackInteraction(e.name,e.companyId,e.diagnosticId,e.surface);return NextResponse.json({ok:true});
  }
  const c=await cookieContext();await limit(operation,c.id,operation==='answers'?300:30,600);
  if(operation==='answers')return NextResponse.json(await sessionRpc('save',c.id,c.hash,saveSchema.parse(body)));
  if(operation==='submit')return NextResponse.json(await sessionRpc('complete',c.id,c.hash,z.object({expected_revision:z.number().int().positive()}).strict().parse(body)));
  return NextResponse.json({error:'not_found'},{status:404});
 }catch(e){const code=e instanceof Error?e.message:'';return NextResponse.json({error:code.includes('conflict')?'conflict':code.includes('expired')?'expired':'unavailable'},{status:code.includes('conflict')?409:code.includes('rate_limited')?429:code.includes('too_large')?413:400});}
}
export const PATCH=POST;
