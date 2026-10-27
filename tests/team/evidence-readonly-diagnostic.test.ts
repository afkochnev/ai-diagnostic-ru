import {beforeEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import columns from '../operator-w2/fixtures/preservation-columns.json';
import {CAPTURE_TABLES} from '../../scripts/operator-w2/capture-queries';
import {acceptedStageCaptureFingerprint,type PreservationSnapshot} from '../../scripts/operator-w2/preservation';
import {evidenceKeyContext} from '../../src/server/team/evidence-channel-key';
import {EVIDENCE_ROOT} from '../../src/server-runtime/team-evidence-readonly';
import {getSafeInnerDiagnostic,type InnerDiagnostic} from '../../scripts/operator-w2/evidence-diagnostic';
import {readStagingEvidenceManifest,runStagingEvidenceReadonly} from '../../scripts/controlled-team-evidence-readonly';

const fsMock=vi.hoisted(()=>({open:vi.fn(),stat:vi.fn(),read:vi.fn(),close:vi.fn()}));
vi.mock('node:fs',async importOriginal=>({...await importOriginal<typeof import('node:fs')>(),openSync:fsMock.open,fstatSync:fsMock.stat,readFileSync:fsMock.read,closeSync:fsMock.close}));
const context=evidenceKeyContext({domain:'aca-w2-evidence-key',version:1,rootRunId:EVIDENCE_ROOT,approvedPlanSHA256:'a'.repeat(64),canonicalAppSHA:'b'.repeat(40)});
const secret='synthetic-existing-auth-flow-secret-0000000000',serviceRole='sb_secret_synthetic_service_auth_only_0000000000';
const H=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function snapshot():PreservationSnapshot{
 const s:PreservationSnapshot={format:'ACA_W2_PRESERVATION_HMAC_V2',algorithm:'HMAC-SHA256',context,capturedAt:'2026-10-25T10:00:00Z',databaseClock:'2026-10-25T10:00:00Z',transactionReadOnly:'on',timezone:'UTC',project:null,tables:Object.fromEntries(CAPTURE_TABLES.map(t=>[t,{columns:(columns as Record<string,string[]>)[t],rows:[]}])),catalogue:H('catalogue'),ledger:{count:58,digest:H('ledger58')},gates:{launch:1,financial:0},wireTraces:[]};
 const p=s.tables['private.controlled_team_policy'];p.rows.push({key:H('key'),full:H('full'),fields:Object.fromEntries(p.columns.map(c=>[c,H(c)])),facts:null});return s;
}
const env={APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co',RENDER_GIT_COMMIT:context.canonicalAppSHA,AUTH_FLOW_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:serviceRole,TEAM_ENABLED:'false',TEAM_CREATION_ENABLED:'false',TEAM_INVITATIONS_ENABLED:'false',BILLING_ENABLED:'false'};
function manifest(s=snapshot()){return {version:2,purpose:'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2',project:'vflgxgdwlftlyjslyrmo',rootRunId:EVIDENCE_ROOT,expectedSHA:context.canonicalAppSHA,approvedPlanSHA256:context.approvedPlanSHA256,expectedCaptureSHA256:acceptedStageCaptureFingerprint(s,context),expectedRowCount:1};}
function expected(stage:InnerDiagnostic['stage'],code:InnerDiagnostic['code']):InnerDiagnostic{return {version:1,layer:'inner',stage,code};}
async function failure(input:unknown,actualEnv:Record<string,string|undefined>,fetchImpl:typeof fetch,observer=vi.fn()){
 let caught:unknown;try{await runStagingEvidenceReadonly(input,actualEnv,fetchImpl,observer);}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(Error);expect(observer).toHaveBeenCalledTimes(1);
 const diagnostic=getSafeInnerDiagnostic(caught);expect(diagnostic).toEqual(observer.mock.calls[0][0]);expect(Object.isFrozen(diagnostic)).toBe(true);
 for(const forbidden of [secret,serviceRole,'raw-sensitive-error','/sensitive/path']){expect(JSON.stringify(diagnostic)).not.toContain(forbidden);expect(String(caught)).not.toContain(forbidden);}
 return diagnostic;
}

it('reports manifest rejection before scope, secret derivation or capture and ignores raw Zod input',async()=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch;
 expect(await failure({...manifest(),expectedSHA:secret,raw:'/sensitive/path'},env,fetchImpl)).toEqual(expected(null,'MANIFEST_DENIED'));
 expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([{APP_URL:'https://audit.iteam.ru'},{SUPABASE_URL:'https://unexpected.invalid'},{RENDER_GIT_COMMIT:'c'.repeat(40)},{TEAM_CREATION_ENABLED:'true'},{TEAM_INVITATIONS_ENABLED:'true'},{BILLING_ENABLED:'true'}])('reports scope denial only after MANIFEST_VALIDATED (%j)',async(change)=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch;
 expect(await failure(manifest(),{...env,...change},fetchImpl)).toEqual(expected('MANIFEST_VALIDATED','STAGING_SCOPE_DENIED'));
 expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([{AUTH_FLOW_SECRET:'short'},{AUTH_FLOW_SECRET:undefined},{SUPABASE_SERVICE_ROLE_KEY:'bad /sensitive/path'},{SUPABASE_SERVICE_ROLE_KEY:undefined}])('reports client denial only after STAGING_SCOPE_VALIDATED (%j)',async(change)=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch;
 expect(await failure(manifest(),{...env,...change},fetchImpl)).toEqual(expected('STAGING_SCOPE_VALIDATED','EVIDENCE_CLIENT_DENIED'));
 expect(fetchImpl).not.toHaveBeenCalled();
});
it.each(['network','http','json','missing-table','extra-schema'])('reports one reserved capture unavailable without inferring transport/schema root cause (%s)',async(kind)=>{
 const fetchImpl=vi.fn(async()=>{if(kind==='network')throw Error(secret+' raw-sensitive-error /sensitive/path');if(kind==='http')return new Response(serviceRole,{status:500});if(kind==='json')return new Response(secret);const s=snapshot();if(kind==='missing-table')delete s.tables['storage.migrations'];if(kind==='extra-schema')return Response.json({...s,raw:secret});return Response.json(s);}) as unknown as typeof fetch;
 expect(await failure(manifest(),env,fetchImpl)).toEqual(expected('CAPTURE_DISPATCH_RESERVED','CAPTURE_READONLY_UNAVAILABLE'));
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it.each([{expectedCaptureSHA256:'f'.repeat(64)},{expectedRowCount:8263}])('reports commitment mismatch only after a validated response (%j)',async(change)=>{
 const fetchImpl=vi.fn(async()=>Response.json(snapshot())) as unknown as typeof fetch;
 expect(await failure({...manifest(),...change},env,fetchImpl)).toEqual(expected('CAPTURE_RESPONSE_VALIDATED','COMMITMENT_OR_ROW_COUNT_MISMATCH'));
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('keeps strict success output and one capture semantics unchanged; no diagnostic is emitted',async()=>{
 const s=snapshot(),observer=vi.fn(),fetchImpl=vi.fn(async()=>Response.json(s)) as unknown as typeof fetch;
 const proof=await runStagingEvidenceReadonly(manifest(s),env,fetchImpl,observer);
 expect(proof).toEqual({status:'STAGING_CROSS_RUNTIME_EVIDENCE_MATCH',context,captureSHA256:acceptedStageCaptureFingerprint(s,context),tableCount:122,rowCount:1,AuthTableCount:27,AuthRows:0,ledger:58,capturedAt:s.capturedAt,actualCapabilityPOSTs:0,actualCapturePOSTs:1,retries:0,W2Writes:0,AuthIssuanceVerificationEmailAIYooKassaPDF:0});
 expect(Object.isFrozen(proof)).toBe(true);expect(observer).not.toHaveBeenCalled();expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(Object.keys(proof)).not.toContain('diagnostic');for(const forbidden of [secret,serviceRole])expect(JSON.stringify(proof)).not.toContain(forbidden);
});
it('an observer throwing raw error cannot replace a safe failure, trigger HTTP or authorize retry',async()=>{
 const fetchImpl=vi.fn() as unknown as typeof fetch,observer=vi.fn(()=>{throw Error(secret+' raw-sensitive-error');});
 let caught:unknown;try{await runStagingEvidenceReadonly({},env,fetchImpl,observer);}catch(error){caught=error;}
 expect(getSafeInnerDiagnostic(caught)).toEqual(expected(null,'MANIFEST_DENIED'));expect(String(caught)).not.toContain(secret);expect(observer).toHaveBeenCalledTimes(1);expect(fetchImpl).not.toHaveBeenCalled();
});

const args=['node','script','/tmp/aca-v27-evidence-channel/storage-inventory-v2.json'];
beforeEach(()=>{for(const mock of Object.values(fsMock))mock.mockReset();fsMock.open.mockReturnValue(17);fsMock.stat.mockReturnValue({isFile:()=>true,uid:process.getuid?.(),mode:0o600,size:100});fsMock.read.mockReturnValue(JSON.stringify(manifest()));});
it('keeps exact fixed path, O_NOFOLLOW, private file and close-on-read behavior for CLI manifest',()=>{
 expect(readStagingEvidenceManifest(args)).toEqual(manifest());expect(fsMock.open).toHaveBeenCalledTimes(1);expect(fsMock.close).toHaveBeenCalledExactlyOnceWith(17);
});
it.each(['arguments','path','open','stat','owner','mode','size','read','json','close'])('sanitizes CLI manifest IO/validation failure as finite MANIFEST_DENIED (%s)',kind=>{
 let input=args;if(kind==='arguments')input=args.slice(0,2);if(kind==='path')input=['node','script','/sensitive/path/'+secret];if(kind==='open')fsMock.open.mockImplementation(()=>{throw Error(secret);});if(kind==='stat')fsMock.stat.mockImplementation(()=>{throw Error(secret);});if(kind==='owner')fsMock.stat.mockReturnValue({isFile:()=>true,uid:-1,mode:0o600,size:100});if(kind==='mode')fsMock.stat.mockReturnValue({isFile:()=>true,uid:process.getuid?.(),mode:0o644,size:100});if(kind==='size')fsMock.stat.mockReturnValue({isFile:()=>true,uid:process.getuid?.(),mode:0o600,size:8193});if(kind==='read')fsMock.read.mockImplementation(()=>{throw Error(secret);});if(kind==='json')fsMock.read.mockReturnValue(secret);if(kind==='close')fsMock.close.mockImplementation(()=>{throw Error(secret);});
 let caught:unknown;try{readStagingEvidenceManifest(input);}catch(error){caught=error;}
 expect(getSafeInnerDiagnostic(caught)).toEqual(expected(null,'MANIFEST_DENIED'));expect(String(caught)).not.toContain(secret);if(['arguments','path'].includes(kind))expect(fsMock.open).not.toHaveBeenCalled();else if(kind!=='open')expect(fsMock.close).toHaveBeenCalledExactlyOnceWith(17);
});
it('actual CLI invalid-argument failure emits only the finite record and the existing generic HOLD',()=>{
 const child=spawnSync(process.execPath,['--import','tsx',resolve('scripts/controlled-team-evidence-readonly.ts'),'/sensitive/path/'+secret],{cwd:resolve('.'),env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8',timeout:15000});
 expect(child.status).toBe(1);expect(child.stdout).toBe('');expect(child.stderr.trim().split('\n')).toEqual(['ACA_W2_EVIDENCE_READONLY_DIAGNOSTIC '+JSON.stringify(expected(null,'MANIFEST_DENIED')),'ACA_W2_EVIDENCE_READONLY_HOLD_NO_RETRY']);
 for(const forbidden of [secret,serviceRole,'/sensitive/path','Error:','stack'])expect(child.stderr).not.toContain(forbidden);
});
it('actual CLI output failure after strict success is UNCLASSIFIED rather than a false manifest rejection',()=>{
 // The preload substitutes only the fixed manifest FD and global fetch. It
 // never creates the fixed path, opens credentials, or performs network I/O.
 const fixture=snapshot(),input=manifest(fixture),preload=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const fixed='/tmp/aca-v27-evidence-channel/storage-inventory-v2.json',fd=2147483000,original={open:fs.openSync,stat:fs.fstatSync,read:fs.readFileSync,close:fs.closeSync};fs.openSync=(path,...rest)=>path===fixed?fd:original.open(path,...rest);fs.fstatSync=(value,...rest)=>value===fd?{isFile:()=>true,uid:process.getuid(),mode:384,size:100}:original.stat(value,...rest);fs.readFileSync=(value,...rest)=>value===fd?${JSON.stringify(JSON.stringify(input))}:original.read(value,...rest);fs.closeSync=(value,...rest)=>value===fd?undefined:original.close(value,...rest);syncBuiltinESMExports();globalThis.fetch=async url=>{if(url!=='https://vflgxgdwlftlyjslyrmo.supabase.co/rest/v1/rpc/capture_controlled_team_w2_preservation')throw Error('unexpected mock request');return Response.json(${JSON.stringify(fixture)});};console.log=()=>{throw Error(${JSON.stringify(secret)});};`;
 const child=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'--import','tsx',resolve('scripts/controlled-team-evidence-readonly.ts'),args[2]],{cwd:resolve('.'),env:{PATH:process.env.PATH,NODE_ENV:'test',...env},encoding:'utf8',timeout:15000});
 expect(child.status).toBe(1);expect(child.stdout).toBe('');expect(child.stderr.trim().split('\n')).toEqual(['ACA_W2_EVIDENCE_READONLY_DIAGNOSTIC '+JSON.stringify(expected(null,'UNCLASSIFIED_SAFE_HOLD')),'ACA_W2_EVIDENCE_READONLY_HOLD_NO_RETRY']);
 for(const forbidden of [secret,serviceRole,'Error:','stack'])expect(child.stderr).not.toContain(forbidden);
});
