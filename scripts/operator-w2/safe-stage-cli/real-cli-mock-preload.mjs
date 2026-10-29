/** TEST ONLY. Used solely by child-process regressions. No hosted source imports
 * this module and no mock branch/port is introduced into the hosted CLI. */
import fs from 'node:fs';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {fixture,J,HERE,NOW} from './real-cli-mock-fixture.mjs';
const sourceOnlyReads=new Map(['entry-cli.mjs','entry-bootstrap.mjs'].map(n=>[join(HERE,n),fs.readFileSync(join(HERE,n))]));
const scenario=process.env.ACA_LOCAL_MOCK_CASE;
if(!/^[a-z-]+$/.test(scenario??''))throw Error('TEST_SCENARIO_REQUIRED');
const f=fixture();
const args=f.args(scenario==='check-local'?'check':'execute');
const path=n=>join(HERE,n);
if(scenario==='malformed-args')args.splice(0,args.length,'--execute-staging');
if(scenario==='manifest-hash')args[1]='0'.repeat(64);
if(scenario==='missing-owner')f.nodes.delete(path(f.config.ownerApprovalFile));
if(scenario==='owner-hash')f.nodes.get(path(f.config.ownerApprovalFile)).data=J({...f.owner,approved:false});
if(scenario==='owner-false'){f.owner.approved=false;f.seal();args.splice(0,args.length,...f.args('execute'));}
if(scenario==='fresh-stale'){f.fresh.observedAt=new Date(NOW-300001).toISOString();f.seal();args.splice(0,args.length,...f.args('execute'));}
if(scenario==='fresh-ci-fail'){f.fresh.CI.application='FAILURE';f.seal();args.splice(0,args.length,...f.args('execute'));}
if(scenario==='source-drift')f.nodes.get('/virtual/reviewed-runtime.mts').data=Buffer.from('changed source bytes');
if(scenario==='git-drift')f.gitMismatch();
if(scenario==='spent-admission')f.file(path(f.config.admissionFile),'OLD_SPENT_ADMISSION_UNCHANGED');
if(scenario==='protected-mode')f.nodes.get(f.protectedPaths[0]).mode=0o100644;
const activity=f.activity;
activity.mockPortCalls=0;activity.oneUseDenied=false;activity.finalReceiptWrites=0;activity.realHTTP=0;
const originalWrite=f.fs.writeSync;
f.fs.writeSync=(fd,b,o,l)=>originalWrite(fd,b,o,l);
for(const name of ['openSync','closeSync','readFileSync','writeSync','fsyncSync','fstatSync','lstatSync','readdirSync','realpathSync','readlinkSync'])fs[name]=f.fs[name];
const fakeRead=fs.readFileSync;
fs.readFileSync=(p,options)=>{
 const sourcePath=p instanceof URL?fileURLToPath(p):p;
 // Only Node's actual CLI/bootstrap module source reads use this exact whitelist.
 // Admission fd reads use Map data; no general real-filesystem fallback exists.
 if(typeof p!=='number'&&sourceOnlyReads.has(sourcePath)){const b=sourceOnlyReads.get(sourcePath),encoding=typeof options==='string'?options:options?.encoding;return encoding?b.toString(encoding):Buffer.from(b);}
 return fakeRead(p,options);
};
cp.execFileSync=f.execFileSync;
const networkDenied=()=>{activity.realHTTP++;throw Error('REAL_NETWORK_FORBIDDEN');};
http.request=networkDenied;http.get=networkDenied;https.request=networkDenied;https.get=networkDenied;net.connect=networkDenied;net.createConnection=networkDenied;
globalThis.fetch=networkDenied;
syncBuiltinESMExports();
process.argv=[f.config.node.path,['import-only','bootstrap-wrong-startup'].includes(scenario)?'/virtual-import-caller':scenario==='bootstrap-direct'?path('entry-bootstrap.mjs'):path('entry-cli.mjs'),...args];
process.execArgv=scenario==='exec-loader'?['--import','evil']:[];
process.execPath=f.config.node.path;
Object.defineProperty(process,'version',{value:f.config.node.version,configurable:true});
Object.defineProperty(process,'platform',{value:f.config.node.platform,configurable:true});
Object.defineProperty(process,'arch',{value:f.config.node.arch,configurable:true});
process.getuid=()=>f.config.uid;
process.env={...f.config.cleanEnvironment};
if(scenario==='dirty-env')process.env.NODE_OPTIONS='prohibited';
class ClockDate extends Date{constructor(...a){super(...(a.length?a:[NOW]));}static now(){return NOW;}}
globalThis.Date=ClockDate;
const bootstrapURL=pathToFileURL(path('entry-bootstrap.mjs')).href;
const bundleURL=pathToFileURL(path('entry-bundle.mjs')).href;
globalThis.__LOCAL_REAL_CLI_PORTS__=Object.freeze({
 entered(){activity.bundleExecutions++;},
 verify(token,v,consume){
  if(!Object.isFrozen(token)||!Object.isFrozen(v)||!Object.isFrozen(v.config))throw Error('OWNED_TOKEN_NOT_FROZEN');
  try{consume(token);throw Error('TOKEN_REUSED');}catch(e){if(!e.message.includes('OWNED_ADMISSION_REQUIRED'))throw e;activity.oneUseDenied=true;}
  v.check();
  if(scenario==='callback-error')throw Error('SYNTHETIC_PRIVATE_CALLBACK_ERROR_MUST_NOT_LEAK');
  activity.mockPortCalls++;
  // Port call is a purely in-memory mock, not any hosted factory or HTTP call.
  return Object.freeze({status:'REAL_CLI_MOCK_PORT_PASS',mockPort:true,oneUse:true});
 },
 finished(){activity.finalReceiptWrites++;}
});
const mockBundle=`import {consumeVerifiedLaunch} from ${JSON.stringify(bootstrapURL)};
export async function executePreparedLaunch(token){
 const ports=globalThis.__LOCAL_REAL_CLI_PORTS__;ports.entered();
 const v=consumeVerifiedLaunch(token);const r=ports.verify(token,v,consumeVerifiedLaunch);
 v.finish(r);ports.finished();return r;
}`;
// TEST ONLY: the bundle is deliberately not published. Resolve exactly its
// synthetic URL before Node checks file existence; no wildcard or hosted hook.
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier===bundleURL)return{url:bundleURL,shortCircuit:true};
 return nextResolve(specifier,context);
},load(url,context,nextLoad){
 if(url===bundleURL){activity.bundleImports++;return{format:'module',source:mockBundle,shortCircuit:true};}
 return nextLoad(url,context);
}});
process.on('exit',code=>{
 const afterAdmission=f.nodes.get(path(f.config.admissionFile));
 const admissionState=afterAdmission?.data.toString('utf8');
 const oldUnchanged=scenario!=='spent-admission'||admissionState==='OLD_SPENT_ADMISSION_UNCHANGED';
 process.stdout.write(JSON.stringify({testTelemetry:true,scenario,code,...activity,oldAdmissionUnchanged:oldUnchanged,actualHostedNamespacesCreated:0,syntheticAdmissionPresent:!!afterAdmission,syntheticReceiptPresent:f.nodes.has(path(f.config.receiptFile)),protectedReads:f.reads.filter(p=>f.protectedPaths.includes(p)).length})+'\n');
});
