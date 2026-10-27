/** Fully synthetic VM admission tests. No real credential, approval, proof,
 * journal, provider, or hosted factory is read/created/called by these tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as realPath from 'node:path';
import * as realURL from 'node:url';
import {constants as fsConstants} from 'node:fs';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
const HERE=realPath.dirname(realURL.fileURLToPath(import.meta.url));
const SOURCE=readFileSync(realPath.join(HERE,'entry-bootstrap.mjs'),'utf8');
const APP='4ddb9337d7d6ec18936009ef7277927b38ea2a17';
const TREE='fabdcb4581214b5a3a64556064122e791f846436';
const PLAN='5c4d56048a97e9137328e384cd37c7d4fc9fdd5f5c703422ad614aa3c96b40e4';
const H=b=>createHash('sha256').update(b).digest('hex');
const C=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(C).join(',')+']':'{'+Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}';
const J=o=>Buffer.from(JSON.stringify(o,null,2)+'\n');
const UID=501,NOW=1793037600000;
const entry=realPath.join(HERE,'entry-bootstrap.mjs');
function fixture(){
 const nodes=new Map(),fds=new Map(),events=[],reads=[],aliases=new Map();let ino=1,nextfd=10,gitFail='',bundleHook;
 const activity={credentialReads:0,network:0,bundleImports:0,bundleExecutions:0,admissionWrites:0};
 const dirs=p=>{if(nodes.has(p))return;const parent=realPath.dirname(p);if(parent!==p)dirs(parent);nodes.set(p,{kind:'dir',mode:0o40755,uid:UID,nlink:1,dev:1,ino:ino++,data:Buffer.alloc(0),mtimeMs:1,ctimeMs:1});};
 const file=(p,b,mode=0o600)=>{dirs(realPath.dirname(p));nodes.set(p,{kind:'file',mode:0o100000|mode,uid:UID,nlink:1,dev:1,ino:ino++,data:Buffer.from(b),mtimeMs:1,ctimeMs:1});};
 const stat=p=>{const n=nodes.get(p);if(!n){const e=Error('virtual absent');e.code='ENOENT';throw e;}return {...n,size:n.data.length,isFile:()=>n.kind==='file',isDirectory:()=>n.kind==='dir',isSymbolicLink:()=>n.kind==='symlink'};};
 dirs(HERE);nodes.get(HERE).mode=0o40700;
 const repo=realPath.resolve(HERE,'../../../ai-diagnostic-v27-team-guard');
 const nodePath='/virtual/pinned-node';file(nodePath,'synthetic pinned executable',0o555);
 const runtime='/virtual/reviewed-runtime.mts';file(runtime,'synthetic reviewed source',0o644);
 const old='/virtual/old-journal';dirs(old);nodes.get(old).mode=0o40700;file(old+'/intent.json','historical intent');file(old+'/receipt.json','historical UNKNOWN_SPENT_STOP');
 const protectedPaths=['/Users/alexanderkochnev/.render/cli.yaml','/Users/alexanderkochnev/.supabase/access-token'];
 for(const p of protectedPaths){file(p,'SYNTHETIC_NEVER_READ_PROTECTED_VALUE');nodes.get(realPath.dirname(p)).mode=0o40700;}
 const pin=p=>{const s=stat(p);return {path:p,SHA256:H(nodes.get(p).data),bytes:s.size,mode:(s.mode&0o7777).toString(8).padStart(4,'0'),uid:UID,nlink:1};};
 const pinpack={files:[pin(runtime)],exactNamespaceInventories:[{root:old,entries:[{relativePath:'intent.json',kind:'file'},{relativePath:'receipt.json',kind:'file'}]}]};
 const budgets={GitHubManagedReads:3,directControlRequests:126,boundBRequests:2,remoteBCapture:1,DBMutations:0};
 const config={kind:'FIXED_4DDB_STAGING_LAUNCH_CONFIG_V1',candidateSHA:APP,candidateTree:TREE,repo,branch:'codex/v27-auth-header-diagnostic',planSHA256:PLAN,rootRunId:'e3623f1d-2da0-4dfe-b600-d747f529c5fc',serviceId:'srv-daiqfnrm8hqs73dtaf1g',workspaceId:'tea-daipgd67bikc739jftl0',controlRoot:'/private/tmp/aca-v27-paid-staging-4ddb-control-v1',BRoot:'/private/tmp/aca-v27-paid-staging-4ddb-b-v1',evidenceRoot:realPath.join(HERE,'execution-evidence'),packageRoot:HERE,ownerApprovalFile:'owner-execution-authorization.json',freshCIFile:'fresh-ci-evidence.json',admissionFile:'run-admission.json',receiptFile:'execution-entry-receipt.json',node:{...pin(nodePath),version:'v26.8.1',platform:'darwin',arch:'arm64'},uid:UID,home:'/Users/alexanderkochnev',cleanEnvironment:{PATH:'/usr/bin:/bin',HOME:'/Users/alexanderkochnev',TMPDIR:'/private/tmp',TZ:'UTC'},timing:{initialCIMaxAgeMs:300000,continuingCIMaxAgeMs:1200000,executionMaxElapsedMs:900000},budgets,executionApproved:false,acceptanceVersion:'safe-stage-4ddb-v1'};
 const authority={kind:'PREPARED_4DDB_NATIVE_CONTEXT_AUTHORITY_V1',applicationSHA:APP,planSHA256:PLAN,staticSourcesSHA256:'',context:{domain:'aca-w2-evidence-key',version:1,rootRunId:config.rootRunId,canonicalAppSHA:APP},executionApproved:false,budgets,paths:{control:config.controlRoot,B:config.BRoot,evidence:config.evidenceRoot}};
 const owner={kind:'OWNER_APPROVED_4DDB_STAGING_EXECUTION_V1',source:'DIRECT_OWNER_SCOPED_AUTHORIZATION_TRANSCRIPTION',approved:true,launchSHA256:'',authoritySHA256:'',applicationSHA:APP,planSHA256:PLAN,approvedAt:new Date(NOW-1000).toISOString(),scope:{oneExactStagingAttempt:true,W2:false,production:false},budgets,ownerEvidence:'Synthetic fixture approval, never real authorization.'};
 const fresh={kind:'FRESH_EXACT_GITHUB_CI_READBACK_V1',source:'MANAGED_GITHUB_CONNECTOR_READBACK',observedAt:new Date(NOW-1000).toISOString(),candidateSHA:APP,PR:16,draft:true,merged:false,CIrun:40378394969,CI:{application:'SUCCESS','isolated-sql':'SUCCESS'},managedReads:3};
 let manifest,launchHash,ownerHash,freshHash;
 function seal(){
  file(realPath.join(HERE,'launch-static-sources.json'),J({kind:'SYNTHETIC_STATIC_SOURCES'}));authority.staticSourcesSHA256=H(nodes.get(realPath.join(HERE,'launch-static-sources.json')).data);
  file(realPath.join(HERE,'runtime-file-pins.json'),J(pinpack));config.runtimeFilePinsSHA256=H(nodes.get(realPath.join(HERE,'runtime-file-pins.json')).data);
  file(entry,SOURCE);file(realPath.join(HERE,'entry-bundle.mjs'),'synthetic bundle source');file(realPath.join(HERE,'launch-config.json'),J(config));file(realPath.join(HERE,'native-context-authority.json'),J(authority));
  const criticalNames=['entry-bootstrap.mjs','entry-bundle.mjs','launch-config.json','runtime-file-pins.json','native-context-authority.json','launch-static-sources.json'];
  manifest={kind:'EXACT_4DDB_STAGING_LAUNCH_MANIFEST_V1',applicationSHA:APP,planSHA256:PLAN,criticalFiles:criticalNames.map(n=>({path:n,SHA256:H(nodes.get(realPath.join(HERE,n)).data),bytes:nodes.get(realPath.join(HERE,n)).data.length})),proposedExecutionScope:owner.scope};
  file(realPath.join(HERE,'launch-manifest.json'),J(manifest));launchHash=H(nodes.get(realPath.join(HERE,'launch-manifest.json')).data);
  owner.launchSHA256=launchHash;owner.authoritySHA256=H(nodes.get(realPath.join(HERE,'native-context-authority.json')).data);
  file(realPath.join(HERE,config.ownerApprovalFile),J(owner));file(realPath.join(HERE,config.freshCIFile),J(fresh));ownerHash=H(nodes.get(realPath.join(HERE,config.ownerApprovalFile)).data);freshHash=H(nodes.get(realPath.join(HERE,config.freshCIFile)).data);
 }
 seal();
 const state={now:NOW,mono:1000};
 const fakeProcess={argv:['/virtual/pinned-node','/virtual-launch-alias'],execArgv:[],getuid:()=>UID,execPath:nodePath,version:'v26.8.1',platform:'darwin',arch:'arm64',env:{...config.cleanEnvironment},exitCode:undefined};
 const fs={constants:fsConstants,lstatSync:stat,fstatSync:fd=>stat(fds.get(fd).path),realpathSync:p=>p==='/virtual-launch-alias'?realPath.join(HERE,'entry-cli.mjs'):aliases.get(p)?.resolved??p,readlinkSync:p=>{const a=aliases.get(p);if(!a)throw Error('not a virtual link');return a.target;},existsSync:p=>nodes.has(p),readdirSync:p=>[...nodes.keys()].filter(x=>realPath.dirname(x)===p&&x!==p).map(x=>realPath.basename(x)),
  openSync(p,flags,mode){if((flags&fsConstants.O_EXCL)&&nodes.has(p)){const e=Error('exists');e.code='EEXIST';throw e;}if(!nodes.has(p)){if(!(flags&fsConstants.O_CREAT)){const e=Error('absent');e.code='ENOENT';throw e;}file(p,'',mode??0o600);events.push('create:'+realPath.basename(p));if(p.endsWith('/run-admission.json'))activity.admissionWrites++;}const s=stat(p);if(s.isSymbolicLink())throw Error('virtual nofollow');const fd=nextfd++;fds.set(fd,{path:p});return fd;},
  closeSync(fd){fds.delete(fd);},fsyncSync(fd){events.push('fsync:'+realPath.basename(fds.get(fd).path));},
  readFileSync(fd){const p=typeof fd==='number'?fds.get(fd).path:fd;reads.push(p);if(protectedPaths.includes(p)){activity.credentialReads++;throw Error('PROTECTED_READ_FORBIDDEN_TEST');}return Buffer.from(nodes.get(p).data);},
  writeSync(fd,b,offset,len){const p=fds.get(fd).path,n=nodes.get(p);n.data=Buffer.concat([n.data,b.subarray(offset,offset+len)]);return len;}
 };
 function execFileSync(cmd,args){events.push('git');if(gitFail)return gitFail;if(args.includes('HEAD^{tree}'))return TREE+'\n';if(args.includes('HEAD'))return APP+'\n';if(args.includes('--porcelain'))return '';if(args.includes('--show-current'))return config.branch+'\n';throw Error('unexpected synthetic git');}
 const builtins={'node:fs':fs,'node:crypto':{createHash},'node:child_process':{execFileSync},'node:path':realPath,'node:url':realURL,'node:perf_hooks':{performance:{now:()=>state.mono}}};
 class ClockDate extends Date{constructor(...a){super(...(a.length?a:[state.now]));}static now(){return state.now;}}
 const context=createContext({Buffer,TextDecoder,URL,Date:ClockDate,process:fakeProcess,console:{log:()=>events.push('console')},fetch:()=>{activity.network++;throw Error('NETWORK_FORBIDDEN_TEST');}});
 let admissionModule;
 async function synthetic(values){const names=Object.keys(values),m=new SyntheticModule(names,function(){for(const n of names)this.setExport(n,values[n]);},{context});await m.link(()=>{throw Error('synthetic import denied');});await m.evaluate();return m;}
 const main=async()=>{admissionModule=new SourceTextModule(SOURCE,{context,identifier:realURL.pathToFileURL(entry).href,initializeImportMeta(meta){meta.url=realURL.pathToFileURL(entry).href;},importModuleDynamically:async(specifier)=>{assert.equal(specifier,realURL.pathToFileURL(realPath.join(HERE,'entry-bundle.mjs')).href);activity.bundleImports++;events.push('bundle-import');return synthetic({async executePreparedLaunch(token){activity.bundleExecutions++;events.push('bundle-execute');const v=admissionModule.namespace.consumeVerifiedLaunch(token);if(bundleHook)return bundleHook({token,verified:v,module:admissionModule});return {status:'SYNTHETIC_EXECUTION_ONLY',applicationSHA:v.config.candidateSHA};}});}});await admissionModule.link(specifier=>{assert.ok(Object.hasOwn(builtins,specifier),'builtin-only import');return synthetic(builtins[specifier]);});await admissionModule.evaluate();return admissionModule.namespace;};
 return {nodes,aliases,dirs,pin,events,reads,activity,config,authority,owner,fresh,pinpack,manifest:()=>manifest,state,process:fakeProcess,protectedPaths,seal,main,gitMismatch:()=>{gitFail='wrong';},bundleHook:f=>{bundleHook=f;},args:mode=>mode==='check'?['--check-local',launchHash]:['--execute-staging',launchHash,ownerHash,freshHash],hashes:()=>({launchHash,ownerHash,freshHash}),file,stat};
}
async function denied(f,args){const m=await f.main();await assert.rejects(m.bootstrapMain(args??f.args('execute')));assert.equal(f.activity.credentialReads,0);assert.equal(f.activity.network,0);assert.equal(f.activity.bundleExecutions,0);assert.equal(f.activity.admissionWrites,0);}

test('import is inert and exports only admission APIs',async()=>{const f=fixture(),m=await f.main();assert.deepEqual(Object.keys(m).sort(),['bootstrapMain','consumeVerifiedLaunch']);assert.deepEqual(f.events,[]);assert.deepEqual(f.reads,[]);});
test('check-local verifies pins without reading approval/proof/credential or importing bundle',async()=>{const f=fixture(),m=await f.main(),r=await m.bootstrapMain(f.args('check'));assert.equal(r.status,'LAUNCH_LOCAL_CHECK_PASS_NOT_EXECUTION_AUTHORITY');assert.equal(r.HOLD,true);assert.equal(f.activity.bundleImports,0);assert.equal(f.activity.credentialReads,0);assert.equal(f.activity.admissionWrites,0);assert.equal(f.reads.some(p=>p.endsWith(f.config.ownerApprovalFile)||p.endsWith(f.config.freshCIFile)),false);});
test('exact valid execute consumes opaque token after durable admission only',async()=>{const f=fixture();f.bundleHook(({token,verified,module})=>{assert.equal(Object.isFrozen(token),true);assert.ok(verified.check);assert.throws(()=>module.namespace.consumeVerifiedLaunch(token),/OWNED_ADMISSION_REQUIRED/);assert.equal(f.activity.admissionWrites,1);return {status:'MOCK_ONLY'};});const m=await f.main(),r=await m.bootstrapMain(f.args('execute'));assert.equal(r.status,'MOCK_ONLY');assert.equal(f.activity.bundleExecutions,1);assert.equal(f.activity.network,0);assert.equal(f.activity.credentialReads,0);assert.ok(f.events.findIndex(x=>x==='fsync:run-admission.json')<f.events.indexOf('bundle-import'));});
test('fabricated admission object is rejected',async()=>{const f=fixture(),m=await f.main();assert.throws(()=>m.consumeVerifiedLaunch({kind:'verified-staging-launch'}),/OWNED_ADMISSION_REQUIRED/);assert.equal(f.activity.bundleExecutions,0);});
for(const args of [[],['--execute-staging'],['--execute'],['--check-local','a'.repeat(64),'b'.repeat(64)],['--execute-staging','a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'--retry'],['--execute-staging','not-a-hash','b'.repeat(64),'c'.repeat(64)]])test('prohibited/malformed CLI is inert: '+JSON.stringify(args),async()=>{const f=fixture();await denied(f,args);assert.equal(f.reads.length,0);});
test('non-clean startup environment is denied',async()=>{const f=fixture();f.process.env.NODE_OPTIONS='--import evil';await denied(f);});
test('execArgv loader override is denied before file reads',async()=>{const f=fixture();f.process.execArgv=['--import','evil'];await denied(f);assert.equal(f.reads.length,0);});
test('wrong manifest hash is denied before dependent file reads',async()=>{const f=fixture();await denied(f,['--execute-staging','0'.repeat(64),...f.args('execute').slice(2)]);assert.equal(f.reads.length,1);});
test('candidate/source hash drift is denied',async()=>{const f=fixture();f.nodes.get('/virtual/reviewed-runtime.mts').data=Buffer.from('modified reviewed source');await denied(f);});
test('dirty/wrong git source is denied',async()=>{const f=fixture();f.gitMismatch();await denied(f);});
test('missing owner approval cannot execute',async()=>{const f=fixture();f.nodes.delete(realPath.join(HERE,f.config.ownerApprovalFile));await denied(f);});
test('owner approval hash mismatch cannot execute',async()=>{const f=fixture();f.nodes.get(realPath.join(HERE,f.config.ownerApprovalFile)).data=J({...f.owner,approved:false});await denied(f);});
test('approved=false remains denied even with exact supplied file hash',async()=>{const f=fixture();f.owner.approved=false;f.seal();await denied(f);});
test('wrong owner scope is denied despite matching hash',async()=>{const f=fixture();f.seal();f.owner.scope={production:true};f.file(realPath.join(HERE,f.config.ownerApprovalFile),J(f.owner));const a=f.args('execute');a[2]=H(J(f.owner));await denied(f,a);});
test('owner approval older than 24h is denied',async()=>{const f=fixture();f.owner.approvedAt=new Date(NOW-86400001).toISOString();f.seal();await denied(f);});
test('fresh proof older than 5min is denied',async()=>{const f=fixture();f.fresh.observedAt=new Date(NOW-300001).toISOString();f.seal();await denied(f);});
test('fresh proof from future is denied',async()=>{const f=fixture();f.fresh.observedAt=new Date(NOW+1).toISOString();f.seal();await denied(f);});
test('fresh proof wrong CIrun is denied',async()=>{const f=fixture();f.fresh.CIrun=1;f.seal();await denied(f);});
test('fresh proof failure is denied',async()=>{const f=fixture();f.fresh.CI.application='FAILURE';f.seal();await denied(f);});
test('fresh proof merged PR is denied',async()=>{const f=fixture();f.fresh.merged=true;f.seal();await denied(f);});
test('critical config permission drift is denied',async()=>{const f=fixture();f.nodes.get(realPath.join(HERE,'launch-config.json')).mode=0o100644;await denied(f);});
test('critical file symlink is denied',async()=>{const f=fixture();f.nodes.get(realPath.join(HERE,'entry-bundle.mjs')).kind='symlink';await denied(f);});
test('private package permission drift is denied',async()=>{const f=fixture();f.nodes.get(HERE).mode=0o40755;await denied(f);assert.equal(f.reads.length,0);});
test('historical namespace unexpected file is denied',async()=>{const f=fixture();f.file('/virtual/old-journal/new-intent.json','prohibited new history');await denied(f);});
test('protected credential metadata failure does not read contents',async()=>{const f=fixture();f.nodes.get(f.protectedPaths[0]).mode=0o100644;await denied(f);});
test('pre-existing admission prevents slot reuse',async()=>{const f=fixture();f.file(realPath.join(HERE,f.config.admissionFile),'spent');await denied(f);});
test('pre-existing hosted namespace prevents attempt reuse',async()=>{const f=fixture();f.file(f.config.BRoot,'spent');await denied(f);});
test('repeat execution is denied after durable admission without second bundle import',async()=>{const f=fixture(),m=await f.main();await m.bootstrapMain(f.args('execute'));await assert.rejects(m.bootstrapMain(f.args('execute')),/ATTEMPT_ALREADY_USED/);assert.equal(f.activity.bundleExecutions,1);assert.equal(f.activity.admissionWrites,1);assert.equal(f.activity.credentialReads,0);});
test('verified check denies changed proof before any runtime effect',async()=>{const f=fixture();f.bundleHook(({verified})=>{f.nodes.get(realPath.join(HERE,f.config.freshCIFile)).data=J({...f.fresh,merged:true});assert.throws(()=>verified.check(),/ADMISSION_RECORD_CHANGED/);return {status:'MOCK_HOLD'};});const m=await f.main();assert.equal((await m.bootstrapMain(f.args('execute'))).status,'MOCK_HOLD');assert.equal(f.activity.network,0);});
test('verified check denies expired monotonic execution deadline',async()=>{const f=fixture();f.bundleHook(({verified})=>{f.state.mono+=900001;assert.throws(()=>verified.check(),/RUN_DEADLINE/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});

// The following paths exist exclusively in this synthetic Map filesystem.
function installAlias(f,{allow=true,target='../stable-deps',resolved='/virtual/stable-deps'}={}){
 const p='/virtual/dependency-alias',path=p+'/module.mts';f.file(path,'synthetic dependency bytes',0o644);const n=f.nodes.get(p);n.kind='symlink';n.mode=0o120777;f.aliases.set(p,{target,resolved});f.pinpack.files.push(f.pin(path));
 if(allow)f.pinpack.permittedExistingDependencyAliases=[{path:p,target,resolved,uid:UID,mode:'0777',nlink:1}];f.seal();return p;
}
function installLibrary(f){const p='/virtual/libs/libnode.dylib';f.file(p,'library bytes',0o555);f.config.runtimeLibraries=[f.pin(p)];f.seal();return p;}
function syntheticB(f,v){
 const mk=p=>{f.dirs(p);f.nodes.get(p).mode=0o40700;};mk(f.config.evidenceRoot);v.registerRoot('evidence',()=>true);
 const body={startCommand:'node synthetic readonly',planId:'plan-srv-006'},rsha=H(C({method:'POST',url:`https://api.render.com/v1/services/${f.config.serviceId}/jobs`,body}));
 f.file(realPath.join(f.config.evidenceRoot,'B-request.json'),J({body,requestSHA256:rsha}));mk(f.config.BRoot);
 const binding={version:1,domain:'aca-paid-staging-acceptance-journal-v1',mode:'HOSTED_STAGING',acceptanceVersion:f.config.acceptanceVersion,expectedSHA:APP,planSHA256:PLAN,requestSHA256:rsha,serviceId:f.config.serviceId,workspaceId:f.config.workspaceId,planId:'plan-srv-006',startCommandSHA256:H(body.startCommand)};
 const bs=H(C(binding)),ns=realPath.join(f.config.BRoot,`paid-acceptance-${f.config.acceptanceVersion}-${bs}`);mk(ns);f.file(realPath.join(ns,'binding.json'),C(binding)+'\n');mk(realPath.join(ns,'capture-b'));
 const common={bindingSHA256:bs,slot:'capture-b',planSHA256:PLAN,expectedSHA:APP,requestSHA256:rsha,serviceId:f.config.serviceId,workspaceId:f.config.workspaceId,mode:'HOSTED_STAGING'};
 const intent=realPath.join(ns,'capture-b','intent.json'),receipt=realPath.join(ns,'capture-b','receipt.json');f.file(intent,J({...common,status:'RESERVED_BEFORE_MUTATION'}));f.file(receipt,J({...common,status:'KNOWN_ACCEPTED',providerId:'job-synthetic-only'}));return {ns,intent,receipt};
}

test('exact allowlisted existing dependency ancestor is accepted',async()=>{const f=fixture();installAlias(f);const m=await f.main();assert.equal((await m.bootstrapMain(f.args('check'))).status,'LAUNCH_LOCAL_CHECK_PASS_NOT_EXECUTION_AUTHORITY');assert.equal(f.activity.credentialReads,0);});
test('unreviewed dependency ancestor alias is denied',async()=>{const f=fixture();installAlias(f,{allow:false});await denied(f);});
for(const [label,change] of [
 ['target',f=>{f.aliases.get('/virtual/dependency-alias').target='../other';}],
 ['resolved target',f=>{f.aliases.get('/virtual/dependency-alias').resolved='/virtual/elsewhere';}],
 ['uid',f=>{f.nodes.get('/virtual/dependency-alias').uid=502;}],
 ['mode',f=>{f.nodes.get('/virtual/dependency-alias').mode=0o120755;}],
 ['link count',f=>{f.nodes.get('/virtual/dependency-alias').nlink=2;}]
])test('allowlisted alias '+label+' mismatch is denied',async()=>{const f=fixture();installAlias(f);change(f);await denied(f);});
test('alias replacement after admission fails repeated guard',async()=>{const f=fixture();installAlias(f);f.bundleHook(({verified})=>{f.aliases.get('/virtual/dependency-alias').target='../replaced';assert.throws(()=>verified.check(),/DEPENDENCY_ALIAS/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('exact pinned runtime dylib is accepted',async()=>{const f=fixture();installLibrary(f);const m=await f.main();assert.equal((await m.bootstrapMain(f.args('check'))).status,'LAUNCH_LOCAL_CHECK_PASS_NOT_EXECUTION_AUTHORITY');});
test('runtime dylib content mismatch is denied before admission',async()=>{const f=fixture(),p=installLibrary(f);f.nodes.get(p).data=Buffer.from('tampered ones');await denied(f);});
test('runtime dylib metadata mismatch is denied before admission',async()=>{const f=fixture(),p=installLibrary(f);f.nodes.get(p).mode=0o100755;await denied(f);});
test('runtime dylib signature change after admission is denied',async()=>{const f=fixture(),p=installLibrary(f);f.bundleHook(({verified})=>{f.nodes.get(p).mtimeMs++;assert.throws(()=>verified.check(),/RUNTIME_LIBRARY_CHANGED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('runtime dylib through nonallowlisted alias is denied',async()=>{const f=fixture(),p=installLibrary(f),parent=realPath.dirname(p);f.nodes.get(parent).kind='symlink';f.nodes.get(parent).mode=0o120777;f.aliases.set(parent,{target:'other-libs',resolved:'/virtual/other-libs'});await denied(f);});
test('pinned node binary hash mismatch is denied',async()=>{const f=fixture();f.nodes.get(f.config.node.path).data=Buffer.from('altered pinned executable!!');await denied(f);});
test('pinned node signature change after admission is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{f.nodes.get(f.config.node.path).mtimeMs++;assert.throws(()=>verified.check(),/NODE_CHANGED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('synthetic B intent/receipt can be observed without effects',async()=>{const f=fixture();f.bundleHook(({verified})=>{syntheticB(f,verified);assert.doesNotThrow(()=>verified.check());return {status:'MOCK_B_MAP_ONLY'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);assert.equal(f.activity.credentialReads,0);});
test('previously observed B receipt removal is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{const b=syntheticB(f,verified);verified.check();f.nodes.delete(b.receipt);assert.throws(()=>verified.check(),/B_RECORD_REMOVED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('previously observed B intent removal is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{const b=syntheticB(f,verified);verified.check();f.nodes.delete(b.intent);assert.throws(()=>verified.check(),/B_RECORD_REMOVED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('observed B root removal is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{const b=syntheticB(f,verified);verified.check();f.nodes.delete(f.config.BRoot);assert.throws(()=>verified.check(),/B_ROOT_REMOVED/);assert.ok(f.nodes.has(b.receipt));return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('B record byte replacement is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{const b=syntheticB(f,verified);verified.check();f.nodes.get(b.receipt).data=J({changed:true});assert.throws(()=>verified.check(),/B_RECORD_CHANGED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('observed B root inode replacement is denied',async()=>{const f=fixture();f.bundleHook(({verified})=>{syntheticB(f,verified);verified.check();f.nodes.get(f.config.BRoot).ino++;assert.throws(()=>verified.check(),/B_ROOT_CHANGED/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});

test('verified config scope is deeply immutable',async()=>{const f=fixture();f.bundleHook(({verified})=>{const before=verified.config.controlRoot;assert.equal(Object.isFrozen(verified.config),true);assert.throws(()=>{verified.config.controlRoot='/virtual/prohibited';},TypeError);assert.equal(verified.config.controlRoot,before);assert.doesNotThrow(()=>verified.check());return {status:'MOCK_ONLY'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
test('verified config timing cannot be weakened after admission',async()=>{const f=fixture();f.bundleHook(({verified})=>{const before=verified.config.timing.executionMaxElapsedMs;assert.equal(Object.isFrozen(verified.config.timing),true);assert.throws(()=>{verified.config.timing.executionMaxElapsedMs=Number.MAX_SAFE_INTEGER;},TypeError);assert.equal(verified.config.timing.executionMaxElapsedMs,before);f.state.mono+=before+1;assert.throws(()=>verified.check(),/RUN_DEADLINE/);return {status:'MOCK_HOLD'};});const m=await f.main();await m.bootstrapMain(f.args('execute'));assert.equal(f.activity.network,0);});
