import { readFileSync } from "node:fs";
import { join,resolve,sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { digest,verifyManifest,type CheckpointManifest,type ReplayOrigin } from "../src/server/team/quality/stage-cache";
export type OriginPin={directory:string;metadataSHA256:string;commit:string;promptSHA256:string;codeSHA256:string;privacyPolicy:string};
function archivedSource(commit:string,file:string){if(!/^[a-f0-9]{40}$/.test(commit))throw Error("quality_resume_invalid");return execFileSync("git",["show",commit+":src/server/team/quality/"+file+".ts"],{encoding:"utf8"});}
const archivedPrompt=(commit:string)=>archivedSource(commit,"prompts");
/** No model or raw data. Reconstruct the original trusted, commit-pinned system
 * message so schema/input/model changes still invalidate an inherited result. */
export function pinOrigin(directory:string,root:string,resume:CheckpointManifest):OriginPin {
 if(!resolve(directory).startsWith(resolve(root)+sep))throw Error("quality_resume_invalid");
 verifyManifest(resume,root);const bytes=readFileSync(join(directory,"run-metadata.json")),meta=JSON.parse(bytes.toString());
 if(meta.status!=="STOPPED"||meta.simulated!==false||meta.quarantined||JSON.stringify(meta.checkpoints)!==JSON.stringify(resume))throw Error("quality_resume_invalid");
 const scopes=Object.values(resume).map(e=>JSON.parse(readFileSync(e.path,"utf8")).scope);
 if(!scopes.length||scopes.some(s=>JSON.stringify(s)!==JSON.stringify(scopes[0])))throw Error("quality_resume_invalid");
 return {directory,metadataSHA256:digest(bytes),commit:meta.commit,promptSHA256:digest(archivedPrompt(meta.commit)),codeSHA256:scopes[0].codeSHA256,privacyPolicy:meta.privacyPolicy??"strict"};
}
export function replayOrigin(pin:OriginPin,root:string,resume:CheckpointManifest):ReplayOrigin {
 if(JSON.stringify(pinOrigin(pin.directory,root,resume))!==JSON.stringify(pin))throw Error("quality_resume_invalid");
 const source=archivedPrompt(pin.commit),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const compiledModule={exports:{} as {stagePrompt?:ReplayOrigin["stagePrompt"]}},localRequire=createRequire(import.meta.url);
 runInNewContext(js,{exports:compiledModule.exports,module:compiledModule,require:(name:string)=>{
  if(["node:fs","node:path"].includes(name))return localRequire(name);
  if(name!=="./editorial-style")throw Error("quality_resume_invalid");
  const styleModule={exports:{}},code=ts.transpileModule(archivedSource(pin.commit,"editorial-style"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports:styleModule.exports,module:styleModule},{timeout:1000});return styleModule.exports;
 },process:{cwd:()=>process.cwd()}},{timeout:1000});
 if(typeof compiledModule.exports.stagePrompt!=="function")throw Error("quality_resume_invalid");
 return {codeSHA256:pin.codeSHA256,stagePrompt:(stage,policy)=>{if(!["extract","diagnose","program"].includes(stage)||policy!==pin.privacyPolicy)throw Error("quality_resume_invalid");return compiledModule.exports.stagePrompt!(stage,policy);}};
}
