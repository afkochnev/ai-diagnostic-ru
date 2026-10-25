// Owner-requested staging proof only; no W2 window, Auth dispatch or provider job.
import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {createRuntimeEvidenceChannel} from '../src/server-runtime/team-auth-evidence';
import {createStagingReadonlyEvidenceClient,EVIDENCE_ROOT,STAGING_EVIDENCE_PROJECT} from '../src/server-runtime/team-evidence-readonly';
export const stagingEvidenceManifestSchema=z.strictObject({version:z.literal(2),purpose:z.literal('STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2'),project:z.literal(STAGING_EVIDENCE_PROJECT),rootRunId:z.literal(EVIDENCE_ROOT),expectedSHA:z.string().regex(/^[a-f0-9]{40}$/),approvedPlanSHA256:z.string().regex(/^[a-f0-9]{64}$/),expectedCaptureSHA256:z.string().regex(/^[a-f0-9]{64}$/),expectedRowCount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export async function runStagingEvidenceReadonly(input:unknown,env:Record<string,string|undefined>,fetchImpl:typeof fetch){
 const manifest=stagingEvidenceManifestSchema.parse(input);
 if(env.APP_URL!=='https://ai-diagnostic-staging-web.onrender.com'||env.SUPABASE_URL!==`https://${STAGING_EVIDENCE_PROJECT}.supabase.co`||env.RENDER_GIT_COMMIT!==manifest.expectedSHA||!['TEAM_ENABLED','TEAM_CREATION_ENABLED','TEAM_INVITATIONS_ENABLED','BILLING_ENABLED'].every(k=>env[k]==='false'))throw Error('staging_evidence_scope_denied');
 const channel=createRuntimeEvidenceChannel({runId:manifest.rootRunId,planHash:manifest.approvedPlanSHA256},env);
 const client=createStagingReadonlyEvidenceClient({context:channel.context,key:channel.key,serviceRole:env.SUPABASE_SERVICE_ROLE_KEY??'',fetch:fetchImpl});
 const capture=await client.capture();
 const tables=Object.values(capture.snapshot.tables),Auth=Object.entries(capture.snapshot.tables).filter(([n])=>n.startsWith('auth.')),rowCount=tables.reduce((n,t)=>n+t.rows.length,0);
 if(capture.fingerprint!==manifest.expectedCaptureSHA256||rowCount!==manifest.expectedRowCount)throw Error('staging_evidence_cross_runtime_mismatch_STOP');
 // Full response was strictly validated and compared in memory. Only the
 // complete data commitment, public context and safe counts leave the process.
 return Object.freeze({status:'STAGING_CROSS_RUNTIME_EVIDENCE_MATCH',context:channel.context,captureSHA256:capture.fingerprint,tableCount:tables.length,rowCount,AuthTableCount:Auth.length,AuthRows:Auth.reduce((n,[,t])=>n+t.rows.length,0),ledger:capture.snapshot.ledger.count,capturedAt:capture.snapshot.capturedAt,actualCapabilityPOSTs:0,actualCapturePOSTs:1,retries:0,W2Writes:0,AuthIssuanceVerificationEmailAIYooKassaPDF:0});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 (async()=>{if(process.argv.length!==3||!/^\/tmp\/aca-v27-evidence-channel\/storage-inventory-v2\.json$/.test(process.argv[2]))throw Error();const fd=openSync(process.argv[2],constants.O_RDONLY|constants.O_NOFOLLOW);let input:unknown;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||stat.size<=0||stat.size>8192)throw Error();input=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}const result=await runStagingEvidenceReadonly(input,process.env,globalThis.fetch);console.log('ACA_W2_EVIDENCE_READONLY '+JSON.stringify(result));})().catch(()=>{console.error('ACA_W2_EVIDENCE_READONLY_HOLD_NO_RETRY');process.exitCode=1;});
}
