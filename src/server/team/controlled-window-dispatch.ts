import {createHash} from 'node:crypto';
import {z} from 'zod';
import {parseControlledTeamManifest,type ControlledTeamManifest} from './controlled-manifest';

// Offline construction and verification only. No provider client, credential,
// filesystem or network access is available through this module.
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.iso.datetime({offset:true});
const stage=z.enum(['team_aggregate','team_ai_report']);
const scopeSchema=z.strictObject({runId:z.uuid(),continuationWindowId:z.uuid(),teamId:z.uuid(),sourceFingerprint:digest,expectedSHA:z.string().regex(/^[a-f0-9]{40}$/),planSHA256:digest});
export type ControlledWindowDispatchScope=z.infer<typeof scopeSchema>;
const fail=():never=>{throw Error('controlled_team_window_dispatch_denied');};
function dataObject(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).some(key=>typeof key!=='string')||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,'value')))fail();
 const nested=(input:unknown,depth:number)=>{
  if(depth>8)fail();
  if(!input||typeof input!=='object')return;
  if(Array.isArray(input)){
   if(Object.getPrototypeOf(input)!==Array.prototype||Object.values(Object.getOwnPropertyDescriptors(input)).some(d=>!Object.hasOwn(d,'value')))fail();
   for(const child of input)nested(child,depth+1);
  }else{
   if(Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(key=>typeof key!=='string'))fail();
   for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))){if(!Object.hasOwn(descriptor,'value'))fail();nested(descriptor.value,depth+1);}
  }
 };
 nested(value,0);
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{dataObject(value);const result=schema.safeParse(value);return result.success?result.data:fail();}
const quote=(value:string)=>`'${value.replaceAll("'","'\"'\"'")}'`;
function boundManifest(value:unknown,scope:ControlledWindowDispatchScope):Readonly<Extract<ControlledTeamManifest,{version:2}>>{
 dataObject(value);
 const m=parseControlledTeamManifest(value);
 if(!('version' in m))return fail();
 if(m.version!==2||Object.entries(scope).some(([key,value])=>m[key as keyof typeof m]!==value))return fail();
 return Object.freeze({...m});
}
export function prepareControlledWindowDispatch(value:unknown,approvedScope:unknown){
 const scope=parse(scopeSchema,approvedScope),manifest=boundManifest(value,scope);
 const manifestJSON=JSON.stringify(manifest),manifestSHA256=hash(manifestJSON);
 const manifestPath=`/tmp/aca-v27-controlled-team/${scope.runId}/${scope.continuationWindowId}/${manifest.kind}-manifest.json`;
 const verify=`const f=require('node:fs'),c=require('node:crypto'),p=process.argv[1],s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||(s.mode&63)||s.size>8192||c.createHash('sha256').update(f.readFileSync(p)).digest('hex')!==${JSON.stringify(manifestSHA256)})process.exit(1);`;
 const command=`cd '/app' && node -e ${quote(verify)} ${quote(manifestPath)} && exec env 'TEAM_ENABLED=true' 'TEAM_AI_PROVIDER=openai' 'TEAM_AI_MODEL=gpt-5.6-sol' node --import tsx scripts/controlled-team-worker.ts ${quote(manifestPath)}`;
 return Object.freeze({manifest,manifestJSON,manifestSHA256,manifestPath,command,commandSHA256:hash(command)});
}
export type ControlledWindowDispatch=ReturnType<typeof prepareControlledWindowDispatch>;
/** Both immutable manifests are just reviewable data; this never creates a
 * report or implies the report exists before its normal request transaction. */
export function prepareControlledWindowManifestPair(approvedScope:unknown,reportId:string){
 const scope=parse(scopeSchema,approvedScope);z.uuid().parse(reportId);
 return Object.freeze({aggregate:prepareControlledWindowDispatch({version:2,...scope,kind:'team_aggregate',reportId:null},scope),report:prepareControlledWindowDispatch({version:2,...scope,kind:'team_ai_report',reportId},scope)});
}

const drainSchema=z.strictObject({observedAt:instant,publicEligible:z.literal(0),publicLeases:z.literal(0),teamEligible:z.literal(0),teamLeases:z.literal(0)});
const instance=z.string().regex(/^srv-dak5rurl550s73a17l60-[A-Za-z0-9]{3,30}$/);
const readinessSchema=scopeSchema.extend({checkedAt:instant,windowState:z.literal('active'),windowArmedAt:instant,windowExpiresAt:instant,environmentFingerprint:digest,expectedEnvironmentFingerprint:digest,allAcquisitionGatesOFF:z.literal(true),allBillingGatesOFF:z.literal(true),genericTeamCreationOFF:z.literal(true),genericTeamInvitationsOFF:z.literal(true),workerServiceId:z.literal('srv-dak5rurl550s73a17l60'),currentInstanceId:instance,stoppedInstanceId:instance,workerSuspended:z.literal(true),workerActuallyAbsent:z.literal(true),currentInstanceStopped:z.literal(true),stopRequestedAt:instant,stopAcknowledgedAt:instant,absenceObservedAt:instant,rootAggregatePostUsed:z.boolean(),rootReportPostUsed:z.literal(false),drains:z.tuple([drainSchema,drainSchema])});
function fresh(value:string,now:number,max=60000){const time=Date.parse(value);if(!Number.isFinite(now)||now<time||now-time>max)fail();return time;}
export function verifyControlledWindowDispatchReadiness(build:ControlledWindowDispatch,value:unknown,now=Date.now()){
 const proof=parse(readinessSchema,value),scope=parse(scopeSchema,Object.fromEntries(Object.keys(scopeSchema.shape).map(key=>[key,proof[key as keyof typeof proof]])));
 boundManifest(build.manifest,scope);fresh(proof.checkedAt,now);const absent=fresh(proof.absenceObservedAt,now),stopped=Date.parse(proof.stopAcknowledgedAt),requested=Date.parse(proof.stopRequestedAt);
 const first=Date.parse(proof.drains[0].observedAt),last=fresh(proof.drains[1].observedAt,now);
 const armed=Date.parse(proof.windowArmedAt),expires=Date.parse(proof.windowExpiresAt);
 if(proof.rootAggregatePostUsed!==(build.manifest.kind==='team_ai_report')||proof.currentInstanceId!==proof.stoppedInstanceId||proof.environmentFingerprint!==proof.expectedEnvironmentFingerprint||requested>stopped||now-requested>4500000||stopped>absent||absent>first||last-first<15000||first>last||last>Date.parse(proof.checkedAt)||armed>now||expires-armed!==3600000||expires<=now||(build.manifest.kind==='team_ai_report'&&expires-now<720000))fail();
 return Object.freeze({status:'CONTROLLED_WINDOW_DISPATCH_READY' as const,runId:scope.runId,continuationWindowId:scope.continuationWindowId,manifestSHA256:build.manifestSHA256,commandSHA256:build.commandSHA256,checkedAt:proof.checkedAt});
}

const terminalSchema=z.strictObject({runId:z.uuid(),continuationWindowId:z.uuid(),teamId:z.uuid(),sourceFingerprint:digest,expectedSHA:z.string().regex(/^[a-f0-9]{40}$/),planSHA256:digest,kind:stage,reportId:z.uuid().nullable(),manifestSHA256:digest,commandSHA256:digest,renderJobId:z.string().regex(/^job-[A-Za-z0-9]{8,100}$/),providerStatus:z.literal('succeeded'),providerStartedAt:instant,providerFinishedAt:instant,numericExitCodeExposedByProvider:z.literal(false),exitCode:z.null(),targetDBJobId:z.uuid(),targetDBStatus:z.literal('completed'),targetAttempts:z.literal(1),targetLeaseToken:z.null(),targetLeaseExpiresAt:z.null(),targetErrorCode:z.null(),checkedAt:instant});
export type ControlledWindowTerminalProof=z.infer<typeof terminalSchema>;
export function verifyControlledWindowTerminal(build:ControlledWindowDispatch,value:unknown,now=Date.now(),requireFresh=true){
 const proof=parse(terminalSchema,value);const rebuilt=prepareControlledWindowDispatch(build.manifest,Object.fromEntries(Object.keys(scopeSchema.shape).map(key=>[key,proof[key as keyof typeof proof]])));
 if(rebuilt.manifestSHA256!==build.manifestSHA256||rebuilt.commandSHA256!==build.commandSHA256||proof.manifestSHA256!==build.manifestSHA256||proof.commandSHA256!==build.commandSHA256||proof.kind!==build.manifest.kind||proof.reportId!==build.manifest.reportId||Date.parse(proof.providerStartedAt)>Date.parse(proof.providerFinishedAt)||Date.parse(proof.providerFinishedAt)>Date.parse(proof.checkedAt)||Date.parse(proof.checkedAt)>now)fail();
 if(requireFresh)fresh(proof.checkedAt,now);
 return Object.freeze({...proof});
}
/** The adapter must durably implement atomic create-if-absent (for example
 * private fs open('wx')). False or an unknown result is spent/STOP, never retry.
 * Its root namespace must also expose every original dispatch receipt. */
export type ControlledWindowJournal={read:(key:string)=>Promise<unknown|undefined>;createExclusive:(key:string,value:unknown)=>Promise<boolean>};
const rootKey=(build:ControlledWindowDispatch,kind:string,suffix:string)=>`root/${build.manifest.runId}/render/${kind}/${suffix}`;
function checked(build:ControlledWindowDispatch){
 const scope=Object.fromEntries(Object.keys(scopeSchema.shape).map(key=>[key,build.manifest[key as keyof typeof build.manifest]]));
 const rebuilt=prepareControlledWindowDispatch(build.manifest,scope);
 if(rebuilt.command!==build.command||rebuilt.commandSHA256!==build.commandSHA256||rebuilt.manifestJSON!==build.manifestJSON||rebuilt.manifestSHA256!==build.manifestSHA256||rebuilt.manifestPath!==build.manifestPath)fail();
 return rebuilt;
}
export async function reserveControlledWindowDispatch(input:ControlledWindowDispatch,journal:ControlledWindowJournal,readiness:unknown,now=Date.now()){
 const build=checked(input);verifyControlledWindowDispatchReadiness(build,readiness,now);
 if(build.manifest.kind==='team_ai_report'){
  const aggregate=prepareControlledWindowDispatch({...build.manifest,kind:'team_aggregate',reportId:null},Object.fromEntries(Object.keys(scopeSchema.shape).map(key=>[key,build.manifest[key as keyof typeof build.manifest]])));
  const prior=await journal.read(rootKey(build,'team_aggregate','terminal'));
  verifyControlledWindowTerminal(aggregate,prior,now,false);
 }
 const key=rootKey(build,build.manifest.kind,'dispatch');
 const record=Object.freeze({status:'RESERVED_BEFORE_POST' as const,runId:build.manifest.runId,continuationWindowId:build.manifest.continuationWindowId,kind:build.manifest.kind,manifestSHA256:build.manifestSHA256,commandSHA256:build.commandSHA256,reservedAt:new Date(now).toISOString(),noRetryAuthorized:true});
 if(!await journal.createExclusive(key,record))fail();
 return Object.freeze({key,record});
}
export async function recordControlledWindowTerminal(input:ControlledWindowDispatch,value:unknown,journal:ControlledWindowJournal,now=Date.now()){
 const build=checked(input),proof=verifyControlledWindowTerminal(build,value,now);
 const reservation=await journal.read(rootKey(build,build.manifest.kind,'dispatch')) as {manifestSHA256?:unknown;commandSHA256?:unknown;continuationWindowId?:unknown}|undefined;
 if(!reservation||reservation.manifestSHA256!==build.manifestSHA256||reservation.commandSHA256!==build.commandSHA256||reservation.continuationWindowId!==build.manifest.continuationWindowId)fail();
 if(!await journal.createExclusive(rootKey(build,build.manifest.kind,'terminal'),proof))fail();
 return proof;
}
