/** Real Node ESM evaluation regression. Admission metadata/filesystem and bundle
 * ports are synthetic in child memory. Actual CLI and inert bootstrap are loaded
 * by the real Node module loader, including awaited bundle -> bootstrap import. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const preload=join(HERE,'real-cli-mock-preload.mjs'),cli=join(HERE,'entry-cli.mjs');
function run(scenario,{importOnly=false,bootstrapAPI=false,bootstrapDirect=false}={}){
 const bootstrap=join(HERE,'entry-bootstrap.mjs');
 const script=bootstrapAPI?`const {bootstrapMain}=await import(${JSON.stringify(pathToFileURL(bootstrap).href)});try{console.log(JSON.stringify(await bootstrapMain(process.argv.slice(2))));}catch{console.log(JSON.stringify({status:'API_HOLD'}));process.exitCode=1;}`:importOnly?`await import(${JSON.stringify(pathToFileURL(cli).href)});`:null;
 const args=['--import',preload,...(script?['--input-type=module','-e',script]:[bootstrapDirect?bootstrap:cli])];
 const r=spawnSync(process.execPath,args,{cwd:HERE,env:{PATH:'/usr/bin:/bin',HOME:'/virtual/no-credentials',TMPDIR:'/private/tmp',TZ:'UTC',ACA_LOCAL_MOCK_CASE:scenario},encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 assert.equal(r.error,undefined,'real child must not time out/fail to start');
 assert.equal(r.signal,null,'real child must not receive a signal');
 const lines=r.stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 const telemetry=lines.find(x=>x.testTelemetry===true);
 assert.ok(telemetry,'must have child exit telemetry');
 assert.equal(telemetry.realHTTP,0);assert.equal(telemetry.credentialReads,0);assert.equal(telemetry.protectedReads,0);assert.equal(telemetry.actualHostedNamespacesCreated,0);assert.equal(telemetry.oldAdmissionUnchanged,true);
 return {...r,lines,telemetry};
}
test('actual CLI -> inert bootstrap -> awaited mock bundle -> SAME bootstrap completes, not exit 13',()=>{
 const r=run('positive');assert.equal(r.status,0,r.stderr);assert.notEqual(r.status,13);assert.equal(r.stderr,'');
 assert.equal(r.lines[0].status,'REAL_CLI_MOCK_PORT_PASS');assert.equal(r.telemetry.bundleImports,1);assert.equal(r.telemetry.bundleExecutions,1);assert.equal(r.telemetry.admissionWrites,1);assert.equal(r.telemetry.mockPortCalls,1);assert.equal(r.telemetry.oneUseDenied,true);assert.equal(r.telemetry.finalReceiptWrites,1);assert.equal(r.telemetry.syntheticReceiptPresent,true);
});
test('actual CLI import-only and bootstrap evaluation remain completely inert',()=>{
 const r=run('import-only',{importOnly:true});assert.equal(r.status,0,r.stderr);assert.equal(r.telemetry.bundleImports,0);assert.equal(r.telemetry.bundleExecutions,0);assert.equal(r.telemetry.admissionWrites,0);assert.equal(r.telemetry.mockPortCalls,0);assert.equal(r.telemetry.syntheticReceiptPresent,false);assert.equal(r.lines.length,1);
});
test('actual --check-local completes without bundle/admission/mock-port/credential activity',()=>{
 const r=run('check-local');assert.equal(r.status,0,r.stderr);assert.equal(r.lines[0].status,'LAUNCH_LOCAL_CHECK_PASS_NOT_EXECUTION_AUTHORITY');assert.equal(r.telemetry.bundleImports,0);assert.equal(r.telemetry.admissionWrites,0);assert.equal(r.telemetry.mockPortCalls,0);
});
for(const scenario of ['malformed-args','manifest-hash','missing-owner','owner-hash','owner-false','fresh-stale','fresh-ci-fail','source-drift','git-drift','spent-admission','protected-mode','exec-loader','dirty-env'])test('real CLI fails closed before mock ports for '+scenario,()=>{
 const r=run(scenario);assert.equal(r.status,1,r.stderr);assert.notEqual(r.status,13);assert.equal(r.stderr,'');assert.equal(r.lines[0].status,'V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE');assert.equal(r.lines[0].phase,'LAUNCH_ADMISSION_OR_ENTRY_HOLD');assert.equal(r.lines[0].retry,false);assert.equal(r.telemetry.bundleImports,0);assert.equal(r.telemetry.bundleExecutions,0);assert.equal(r.telemetry.admissionWrites,0);assert.equal(r.telemetry.mockPortCalls,0);assert.equal(r.telemetry.syntheticReceiptPresent,false);
});
test('real callback error becomes generic nonzero HOLD, never raw error, receipt, or exit 13',()=>{
 const r=run('callback-error');assert.equal(r.status,1,r.stderr);assert.notEqual(r.status,13);assert.equal(r.stderr,'');assert.equal(r.lines[0].status,'V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE');assert.equal(r.lines[0].phase,'LAUNCH_ADMISSION_OR_ENTRY_HOLD');assert.equal(r.telemetry.bundleImports,1);assert.equal(r.telemetry.bundleExecutions,1);assert.equal(r.telemetry.admissionWrites,1);assert.equal(r.telemetry.oneUseDenied,true);assert.equal(r.telemetry.mockPortCalls,0);assert.equal(r.telemetry.finalReceiptWrites,0);assert.equal(r.telemetry.syntheticReceiptPresent,false);assert.equal(r.stdout.includes('SYNTHETIC_PRIVATE_CALLBACK_ERROR'),false);
});

test('direct bootstrap module invocation is inert and cannot act as the CLI',()=>{
 const r=run('bootstrap-direct',{bootstrapDirect:true});assert.equal(r.status,0,r.stderr);assert.equal(r.lines.length,1);assert.equal(r.telemetry.bundleImports,0);assert.equal(r.telemetry.bundleExecutions,0);assert.equal(r.telemetry.admissionWrites,0);assert.equal(r.telemetry.mockPortCalls,0);
});
test('explicit bootstrap API invocation completes through real mock bundle graph',()=>{
 const r=run('bootstrap-api',{bootstrapAPI:true});assert.equal(r.status,0,r.stderr);assert.notEqual(r.status,13);assert.equal(r.lines[0].status,'REAL_CLI_MOCK_PORT_PASS');assert.equal(r.telemetry.bundleImports,1);assert.equal(r.telemetry.oneUseDenied,true);assert.equal(r.telemetry.mockPortCalls,1);assert.equal(r.telemetry.finalReceiptWrites,1);
});
test('explicit bootstrap API still denies wrong startup argv before admission',()=>{
 const r=run('bootstrap-wrong-startup',{bootstrapAPI:true});assert.equal(r.status,1,r.stderr);assert.equal(r.lines[0].status,'API_HOLD');assert.equal(r.telemetry.bundleImports,0);assert.equal(r.telemetry.admissionWrites,0);assert.equal(r.telemetry.mockPortCalls,0);
});
