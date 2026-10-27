import {it,expect,vi} from 'vitest';
import {createHash,createHmac} from 'node:crypto';
import columns from '../operator-w2/fixtures/preservation-columns.json';
import {CAPTURE_TABLES} from '../../scripts/operator-w2/capture-queries';
import {acceptedStageCaptureFingerprint,type PreservationSnapshot} from '../../scripts/operator-w2/preservation';
import {deriveEvidenceChannelKey,evidenceKeyContext,evidenceKeyContextMessage} from '../../src/server/team/evidence-channel-key';
import {createStagingReadonlyEvidenceClient,EVIDENCE_ROOT} from '../../src/server-runtime/team-evidence-readonly';
import {runStagingEvidenceReadonly} from '../../scripts/controlled-team-evidence-readonly';
const context=evidenceKeyContext({domain:'aca-w2-evidence-key',version:1,rootRunId:EVIDENCE_ROOT,approvedPlanSHA256:'a'.repeat(64),canonicalAppSHA:'b'.repeat(40)});
const secret='synthetic-existing-auth-flow-secret-0000000000',serviceRole='sb_secret_synthetic_service_auth_only_0000000000';
const H=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function snapshot():PreservationSnapshot{
 const s:PreservationSnapshot={format:'ACA_W2_PRESERVATION_HMAC_V2',algorithm:'HMAC-SHA256',context,capturedAt:'2026-10-25T10:00:00Z',databaseClock:'2026-10-25T10:00:00Z',transactionReadOnly:'on',timezone:'UTC',project:null,tables:Object.fromEntries(CAPTURE_TABLES.map(t=>[t,{columns:(columns as Record<string,string[]>)[t],rows:[]}])),catalogue:H('catalogue'),ledger:{count:58,digest:H('ledger58')},gates:{launch:1,financial:0},wireTraces:[]};
 const p=s.tables['private.controlled_team_policy'];p.rows.push({key:H('key'),full:H('full'),fields:Object.fromEntries(p.columns.map(c=>[c,H(c)])),facts:null});return s;
}
const env={APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co',RENDER_GIT_COMMIT:context.canonicalAppSHA,AUTH_FLOW_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:serviceRole,TEAM_ENABLED:'false',TEAM_CREATION_ENABLED:'false',TEAM_INVITATIONS_ENABLED:'false',BILLING_ENABLED:'false'};
function response(){return {matched:true,run_id:EVIDENCE_ROOT,window_id:null,participant_id:'0ae17418-e97a-46c7-9000-c13580f72506',user_id:'b7cc06c7-056c-4fd8-b445-eeaf187cec7c',operation:'capability',reservation_id:null,server_now:'2026-10-25T10:00:00Z',approved_plan_hash:null};}
function options(fetchImpl:typeof fetch){return {context,key:deriveEvidenceChannelKey(secret,context),serviceRole,fetch:fetchImpl};}
it('shares actual web runtime derivation with one bounded stage oneoff and emits only safe result',async()=>{
 const s=snapshot(),expected=acceptedStageCaptureFingerprint(s,context),headerValues:string[]=[],bodies:Record<string,unknown>[]=[];
 const fetchImpl=vi.fn(async(url,init)=>{
  expect(url).toMatch(/^https:\/\/vflgxgdwlftlyjslyrmo\.supabase\.co\/rest\/v1\/rpc\/capture_controlled_team_w2_preservation$/);
  expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');expect(init?.cache).toBe('no-store');
  const h=new Headers(init?.headers),key=createHmac('sha256',secret).update(evidenceKeyContextMessage(context)).digest();
  expect(h.get('authorization')).toBe('Bearer '+serviceRole);expect(h.get('apikey')).toBe(serviceRole);
  expect(h.get('x-aca-w2-evidence-key')).toBe('aca-w2-v1.'+key.toString('hex'));headerValues.push(h.get('x-aca-w2-evidence-key')!);
  const body=JSON.parse(String(init?.body));bodies.push(body);expect(JSON.stringify(body)).not.toContain(secret);expect(JSON.stringify(body)).not.toContain(serviceRole);expect(JSON.stringify(body)).not.toContain(key.toString('hex'));
  expect(body).toEqual({p_run_id:EVIDENCE_ROOT,p_plan_sha256:context.approvedPlanSHA256,p_application_sha:context.canonicalAppSHA});return Response.json(s);
 }) as unknown as typeof fetch;
 const manifest={version:2,purpose:'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2',project:'vflgxgdwlftlyjslyrmo',rootRunId:EVIDENCE_ROOT,expectedSHA:context.canonicalAppSHA,approvedPlanSHA256:context.approvedPlanSHA256,expectedCaptureSHA256:expected,expectedRowCount:1};
 const proof=await runStagingEvidenceReadonly(manifest,env,fetchImpl);expect(proof.status).toBe('STAGING_CROSS_RUNTIME_EVIDENCE_MATCH');expect(proof.captureSHA256).toBe(expected);expect(proof.actualCapabilityPOSTs).toBe(0);expect(proof.actualCapturePOSTs).toBe(1);expect(Object.keys(proof)).not.toContain('capability');expect(fetchImpl).toHaveBeenCalledTimes(1);
 const serialized=JSON.stringify(proof);for(const forbidden of [secret,serviceRole,...headerValues])expect(serialized).not.toContain(forbidden);
 expect(proof.W2Writes).toBe(0);expect(proof.AuthIssuanceVerificationEmailAIYooKassaPDF).toBe(0);
});
it('makes imports and construction inert, consumes finite capability/capture once',async()=>{
 const fetchImpl=vi.fn(async(url)=>Response.json(String(url).endsWith('check_controlled_team_auth_evidence_key')?response():snapshot())) as unknown as typeof fetch;
 const client=createStagingReadonlyEvidenceClient(options(fetchImpl));expect(fetchImpl).not.toHaveBeenCalled();await client.capability();await expect(client.capability()).rejects.toThrow();await client.capture();await expect(client.capture()).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('rejects a real opaque handle from any different root/plan/build before dispatch',()=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch;
 for(const change of [{rootRunId:'00000000-0000-4000-8000-000000000001'},{approvedPlanSHA256:'c'.repeat(64)},{canonicalAppSHA:'c'.repeat(40)}]){
  const key=deriveEvidenceChannelKey(secret,evidenceKeyContext({...context,...change}));
  expect(()=>createStagingReadonlyEvidenceClient({context,key,serviceRole,fetch:fetchImpl})).toThrow();
 }
 expect(fetchImpl).not.toHaveBeenCalled();
});
it.each(['network','http','redirect','bad-matched','extra','invalid-json','oversize'])('fails once without fallback/retry for %s',async(kind)=>{
 const fetchImpl=vi.fn(async()=>{if(kind==='network')throw Error(secret);if(kind==='http')return new Response(secret,{status:500});if(kind==='redirect'){const r=Response.json(response());Object.defineProperty(r,'redirected',{value:true});return r;}if(kind==='bad-matched')return Response.json({...response(),matched:false});if(kind==='extra')return Response.json({...response(),unexpected:secret});if(kind==='invalid-json')return new Response(secret);if(kind==='oversize')return new Response('x',{headers:{'content-length':'8193'}});return Response.json(response());}) as unknown as typeof fetch;
 const client=createStagingReadonlyEvidenceClient(options(fetchImpl));await expect(client.capability()).rejects.toThrow();await expect(client.capability()).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it.each([{APP_URL:'https://audit.iteam.ru'},{SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'},{TEAM_ENABLED:'true'},{BILLING_ENABLED:'true'},{RENDER_GIT_COMMIT:'c'.repeat(40)},{AUTH_FLOW_SECRET:'short'}])('refuses invalid actual runtime environment before dispatch',async(change)=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch,s=snapshot();await expect(runStagingEvidenceReadonly({version:2,purpose:'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2',project:'vflgxgdwlftlyjslyrmo',rootRunId:EVIDENCE_ROOT,expectedSHA:context.canonicalAppSHA,approvedPlanSHA256:context.approvedPlanSHA256,expectedCaptureSHA256:acceptedStageCaptureFingerprint(s,context),expectedRowCount:1},{...env,...change},fetchImpl)).rejects.toThrow();expect(fetchImpl).not.toHaveBeenCalled();
});

it('binds a fresh dynamic full row count without an old8263-row allowance',async()=>{
 const s=snapshot(),table=s.tables['storage.migrations'];
 for(let i=0;i<3;i++)table.rows.push({key:H(['storage-history',i]),full:H(['full',i]),fields:Object.fromEntries(table.columns.map(c=>[c,H([c,i])])),facts:null});
 const fingerprint=acceptedStageCaptureFingerprint(s,context),manifest={version:2,purpose:'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2',project:'vflgxgdwlftlyjslyrmo',rootRunId:EVIDENCE_ROOT,expectedSHA:context.canonicalAppSHA,approvedPlanSHA256:context.approvedPlanSHA256,expectedCaptureSHA256:fingerprint,expectedRowCount:4};
 const fetchImpl=vi.fn(async(url)=>Response.json(String(url).endsWith('check_controlled_team_auth_evidence_key')?response():s)) as unknown as typeof fetch;
 const proof=await runStagingEvidenceReadonly(manifest,env,fetchImpl);expect(proof.tableCount).toBe(122);expect(proof.rowCount).toBe(4);expect(proof.ledger).toBe(58);expect(proof.actualCapabilityPOSTs).toBe(0);expect(fetchImpl).toHaveBeenCalledTimes(1);
 const wrong=vi.fn(async(url)=>Response.json(String(url).endsWith('check_controlled_team_auth_evidence_key')?response():s)) as unknown as typeof fetch;
 await expect(runStagingEvidenceReadonly({...manifest,expectedRowCount:8263},env,wrong)).rejects.toThrow('staging_evidence_cross_runtime_mismatch_STOP');expect(wrong).toHaveBeenCalledTimes(1);
});
it.each([undefined,-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects an unbound/invalid expectedRowCount before any dispatch (%s)',async(expectedRowCount)=>{
 const s=snapshot(),fetchImpl=vi.fn() as unknown as typeof fetch;
 await expect(runStagingEvidenceReadonly({version:2,purpose:'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2',project:'vflgxgdwlftlyjslyrmo',rootRunId:EVIDENCE_ROOT,expectedSHA:context.canonicalAppSHA,approvedPlanSHA256:context.approvedPlanSHA256,expectedCaptureSHA256:acceptedStageCaptureFingerprint(s,context),expectedRowCount},env,fetchImpl)).rejects.toThrow();expect(fetchImpl).not.toHaveBeenCalled();
});

it.each(['network','http','redirect','missing-table','extra-envelope','invalid-json','oversize'])('consumes B capture once with no capability or retry after %s',async(kind)=>{
 const fetchImpl=vi.fn(async(url)=>{expect(String(url)).toBe('https://vflgxgdwlftlyjslyrmo.supabase.co/rest/v1/rpc/capture_controlled_team_w2_preservation');if(kind==='network')throw Error(secret);if(kind==='http')return new Response(secret,{status:500});if(kind==='redirect'){const r=Response.json(snapshot());Object.defineProperty(r,'redirected',{value:true});return r;}if(kind==='invalid-json')return new Response(secret);if(kind==='oversize')return new Response('x',{headers:{'content-length':String(48*1024*1024+1)}});const s=snapshot();if(kind==='missing-table')delete s.tables['storage.migrations'];if(kind==='extra-envelope')(s as unknown as Record<string,unknown>).rawHeader=secret;return Response.json(s);}) as unknown as typeof fetch;
 const client=createStagingReadonlyEvidenceClient(options(fetchImpl));await expect(client.capture()).rejects.toThrow();await expect(client.capture()).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(1);
});
