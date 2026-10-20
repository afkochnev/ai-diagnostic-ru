import { createHash } from "node:crypto";
import { lstatSync,readFileSync,writeFileSync,mkdirSync,unlinkSync,realpathSync } from "node:fs";
import { dirname,join,resolve,sep } from "node:path";
import { approvedRequestBody } from "./openai-port";
import type { CheckpointStage,StageRequest } from "./runtime";

export const checkpointOrder:CheckpointStage[]=["extract","diagnose","program","core","dynamics"];
export type CheckpointEntry={path:string;sha256:string};
export type CheckpointManifest=Partial<Record<CheckpointStage,CheckpointEntry>>;
export type ReplayOrigin={codeSHA256:string;stagePrompt:(stage:StageRequest["stage"],policy:StageRequest["privacyPolicy"])=>string};
export type CacheScope={sourceFingerprint:string;codeSHA256:string;model:"gpt-5.6-sol";effort:"medium"};
export const digest=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const jsonHash=(value:unknown)=>digest(JSON.stringify(value));
const fail=()=>{throw new Error("quality_checkpoint_rejected");};
function privateStat(path:string,directory=false){
 const s=lstatSync(path),uid=process.getuid?.();
 if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||(s.mode&0o077)!==0||(uid!==undefined&&s.uid!==uid))fail();
 if(realpathSync(path)!==resolve(path))fail();
 return s;
}
export function verifyManifest(manifest:CheckpointManifest,allowedRoot:string){
 const keys=Object.keys(manifest),prefix=checkpointOrder.slice(0,keys.length);
 if(keys.length>5||keys.some((key,i)=>key!==prefix[i]))fail();
 for(const entry of Object.values(manifest)){
   const path=resolve(entry.path);
   if(!path.startsWith(resolve(allowedRoot)+sep))fail();
   privateStat(dirname(path),true);const stat=privateStat(path);
   if(stat.size>2_000_000||digest(readFileSync(path))!==entry.sha256)fail();
 }
 return prefix;
}
function requestHash(request:StageRequest,origin?:ReplayOrigin){
 // SQL independently reshuffles each question on every read. Canonicalize only
 // the local hash, never the actual AI input or respondent order across questions.
 const copy=structuredClone(request.input) as {groups?:{question_position:number;texts:string[]}[]};
 if(request.stage==="extract"&&Array.isArray(copy?.groups)){
   for(const g of copy.groups)g.texts.sort();
   copy.groups.sort((a,b)=>a.question_position-b.question_position);
 }
 const body=approvedRequestBody({...request,input:copy},"gpt-5.6-sol","medium");
 if(origin)body.input[0].content=origin.stagePrompt(request.stage,request.privacyPolicy);
 return jsonHash(body);
}
/** Private local research cache only. The caller saves through checkedStage,
 * after runtime guards, and revalidates every replay through the same runtime. */
export function createStageCache(directory:string,allowedRoot:string,scope:CacheScope,resume:CheckpointManifest={},origin?:ReplayOrigin){
 verifyManifest(resume,allowedRoot);privateStat(dirname(directory),true);mkdirSync(directory,{mode:0o700});
 const manifest:CheckpointManifest={},provenance=new Map<string,CheckpointEntry>();
 return {
   read(request:StageRequest):unknown|undefined{
     const entry=resume[request.stage as CheckpointStage];if(!entry)return undefined;
     verifyManifest(resume,allowedRoot);
     const v=JSON.parse(readFileSync(entry.path,"utf8"));
     const inherited=v.scope?.codeSHA256!==scope.codeSHA256;
     if(inherited&&(!origin||v.scope?.codeSHA256!==origin.codeSHA256))fail();
     if(v.version!==1||v.stage!==request.stage||v.scope?.sourceFingerprint!==scope.sourceFingerprint||v.scope?.model!==scope.model||v.scope?.effort!==scope.effort||v.requestSHA256!==requestHash(request,inherited?origin:undefined)||v.outputSHA256!==jsonHash(v.value))fail();
     provenance.set(request.stage,entry);return request.schema.parse(v.value);
   },
   save(request:StageRequest,value:unknown){
     const stage=request.stage as CheckpointStage;
     if(checkpointOrder[Object.keys(manifest).length]!==stage||manifest[stage])fail();
     const parsed=request.schema.parse(value),path=join(directory,stage+".json");
     const text=JSON.stringify({version:1,stage,scope,requestSHA256:requestHash(request),outputSHA256:jsonHash(parsed),value:parsed,...provenance.has(stage)?{origin:provenance.get(stage)}:{}},null,2)+"\n";
     if(Buffer.byteLength(text)>2_000_000)fail();
     writeFileSync(path,text,{mode:0o600,flag:"wx"});manifest[stage]={path,sha256:digest(text)};
   },
   manifest:()=>structuredClone(manifest),
   quarantine(){for(const {path} of Object.values(manifest))unlinkSync(path);for(const stage of checkpointOrder)delete manifest[stage];},
 };
}
