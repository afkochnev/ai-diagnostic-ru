/** Test-only synthetic Map filesystem. Import reads only local reviewed source;
 * no protected credential/hosted namespace values are read or created. */
import {readFileSync,constants as fsConstants} from 'node:fs';
import {createHash} from 'node:crypto';
import * as realPath from 'node:path';
import * as realURL from 'node:url';
const HERE=realPath.dirname(realURL.fileURLToPath(import.meta.url));
const SOURCE=readFileSync(realPath.join(HERE,'entry-bootstrap.mjs'),'utf8');
const APP='4ddb9337d7d6ec18936009ef7277927b38ea2a17';
const TREE='fabdcb4581214b5a3a64556064122e791f846436';
const PLAN='5c4d56048a97e9137328e384cd37c7d4fc9fdd5f5c703422ad614aa3c96b40e4';
const H=b=>createHash('sha256').update(b).digest('hex');
const J=o=>Buffer.from(JSON.stringify(o,null,2)+'\n');
const UID=501,NOW=1793037600000;
const entry=realPath.join(HERE,'entry-bootstrap.mjs');
function fixture(){
 const nodes=new Map(),fds=new Map(),events=[],reads=[],aliases=new Map();let ino=1,nextfd=10,gitFail='';
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
 return {nodes,aliases,dirs,pin,events,reads,activity,config,authority,owner,fresh,pinpack,manifest:()=>manifest,state,process:fakeProcess,protectedPaths,seal,hashes:()=>({launchHash,ownerHash,freshHash}),args:mode=>mode==='check'?['--check-local',launchHash]:['--execute-staging',launchHash,ownerHash,freshHash],file,stat,fs,execFileSync,gitMismatch:()=>{gitFail='wrong';}};
}
export {fixture,H,J,HERE,NOW,APP,PLAN};
