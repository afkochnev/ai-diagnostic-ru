import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,createHmac} from 'node:crypto';
import {FIXED,PARTICIPANTS,assertData,need} from './contract';
const DOMAIN='AI-COMPANY-AUDIT/V27/W2/UNUSED-FIXTURE-ASSIGNMENT/V1\0';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
export const FROZEN_FIXTURE=Object.freeze({assignmentCommitmentSHA256:'09b581934c689c01596d1e4ee21c6837e455bc1f9648445fb65d7f0d819d3404',datasetSHA256:'1e64ba52d9cf1afda0107b3ad8d1c204ac3300214cdc94a8a26c909dd7e88afe',privateFileSHA256:'d060c52a35f8d3d01b753a5cca8725ef31e4d92fec17b4c4ad621ce7a4f5e663'});
const oldScope=Object.freeze({canonicalSHA:FIXED.oldSHA,rootRunId:FIXED.root,teamId:FIXED.team,methodologyVersionId:'310c53d3-91bf-4501-ac6a-0cd41771a7ef'});
type Control={questionId:string;tagName:'SELECT'|'TEXTAREA';value:string};
type FixtureValue={version:1;status:'LOCAL_UNUSED_SYNTHETIC_PREPARATION';scope:typeof oldScope;createdAt:string;datasetSHA256:string;profiles:{abstractProfile:number;controls:Control[]}[];assignment:{participantId:string;abstractProfile:number}[];saltHex:string};
type Binding={assignmentCommitmentSHA256:string;datasetSHA256:string;privateFileSHA256:string};
export type CommittedFixture=Readonly<{assignmentCommitmentSHA256:string;datasetSHA256:string;privateFileSHA256:string;mode:'PRODUCTION'|'LOCAL_MOCK';rawMappingSaltAnswersReturned:false}>;
const owned=new WeakMap<CommittedFixture,FixtureValue>();
const hash=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
/** Original salted-commitment canonical encoding. Not PostgreSQL jsonb text. */
export function fixtureCanonicalJSON(v:unknown):string{assertData(v);if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(fixtureCanonicalJSON).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+fixtureCanonicalJSON((v as Record<string,unknown>)[k])).join(',')+'}';}
function exact(a:unknown,b:unknown){return fixtureCanonicalJSON(a)===fixtureCanonicalJSON(b);}
function parseBytes(bytes:Uint8Array,binding:Binding,mode:'PRODUCTION'|'LOCAL_MOCK'):CommittedFixture{
 need(bytes.byteLength>0&&bytes.byteLength<=131072&&Object.values(binding).every(v=>HASH.test(v)),'fixture_size_binding');
 if(mode==='PRODUCTION')need(exact(binding,FROZEN_FIXTURE),'frozen_private_fixture_only');
 need(hash(bytes)===binding.privateFileSHA256,'fixture_file_commitment');let v:FixtureValue;try{v=JSON.parse(Buffer.from(bytes).toString('utf8')) as FixtureValue;}catch{throw Error('w2_operator_fixture_HOLD');}assertData(v);
 need(exact(Object.keys(v).sort(),['assignment','createdAt','datasetSHA256','profiles','saltHex','scope','status','version'].sort())&&v.version===1&&v.status==='LOCAL_UNUSED_SYNTHETIC_PREPARATION'&&exact(v.scope,oldScope)&&Number.isFinite(Date.parse(v.createdAt))&&Date.parse(v.createdAt)<=Date.now()&&HASH.test(v.saltHex),'fixture_shape_scope');
 need(Array.isArray(v.profiles)&&v.profiles.length===3&&exact(v.profiles.map(p=>p.abstractProfile),[-1,0,1])&&hash(fixtureCanonicalJSON(v.profiles))===v.datasetSHA256&&v.datasetSHA256===binding.datasetSHA256,'fixture_exact_dataset');
 let questionSet:string[]|null=null;for(const p of v.profiles){need(exact(Object.keys(p).sort(),['abstractProfile','controls'])&&Array.isArray(p.controls)&&p.controls.length===84,'fixture_controls');let numeric=0,text=0;for(const c of p.controls){need(exact(Object.keys(c).sort(),['questionId','tagName','value'])&&UUID.test(c.questionId)&&typeof c.value==='string'&&!/[\u0000\uD800-\uDFFF]/u.test(c.value),'fixture_control_shape');if(c.tagName==='SELECT'){need(/^[0-4]$/.test(c.value),'fixture_scale');numeric++;}else{need(c.tagName==='TEXTAREA'&&c.value.trim().length>0&&c.value.length<=10000,'fixture_text');text++;}}const ids=p.controls.map(c=>c.questionId).sort();need(new Set(ids).size===84&&numeric===80&&text===4&&(questionSet===null||exact(ids,questionSet)),'fixture_same84controls');questionSet=ids;}
 need(Array.isArray(v.assignment)&&v.assignment.length===3&&exact(v.assignment.map(p=>p.participantId),PARTICIPANTS)&&exact(v.assignment.map(p=>p.abstractProfile).sort((a,b)=>a-b),[-1,0,1])&&v.assignment.every(x=>exact(Object.keys(x).sort(),['abstractProfile','participantId'])),'fixture_exact_assignment');
 const input={...oldScope,createdAt:v.createdAt,datasetSHA256:v.datasetSHA256,participantIds:PARTICIPANTS,assignment:v.assignment,saltHex:v.saltHex};const commitment=hash(DOMAIN+fixtureCanonicalJSON(input));need(commitment===binding.assignmentCommitmentSHA256&&commitment!=='84a5f0776edb9f4834e83472c65f92d8ab12165209342af5f2f9de4e8d28b5c3','fixture_salted_assignment');
 const handle=Object.freeze({...binding,mode,rawMappingSaltAnswersReturned:false as const});owned.set(handle,v);return handle;
}
/** No invocation at import. Future production use reads only this existing
 * immutable private file: no recreation, reassignment, chmod or used-marker reset. */
function protectedFixtureBytes(path:string,base='/private/tmp'):Buffer{
 let fd:number|undefined;try{need(isAbsolute(base)&&base!=='/'&&resolve(base)===base&&realpathSync(base)===base&&isAbsolute(path)&&path.startsWith(base+'/')&&resolve(path)===path&&realpathSync(path)===path,'fixture_private_path');const uid=process.getuid?.();let parent=dirname(path);while(parent!==base){const s=lstatSync(parent);need(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700&&(uid===undefined||s.uid===uid),'fixture_private_ancestor');parent=dirname(parent);need(parent===base||parent.startsWith(base+'/'),'fixture_ancestor_escape');}const st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&(st.mode&0o777)===0o600&&(uid===undefined||st.uid===uid)&&st.size>0&&st.size<=131072,'fixture_private_file');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd);need(opened.dev===st.dev&&opened.ino===st.ino&&opened.size===st.size,'fixture_file_race');const bytes=Buffer.alloc(st.size);let offset=0;while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);need(n>0,'fixture_short_read');offset+=n;}const extra=Buffer.alloc(1);need(readSync(fd,extra,0,1,null)===0&&fstatSync(fd).size===st.size,'fixture_growing_file');return bytes;}catch{throw Error('w2_operator_private_fixture_HOLD');}finally{if(fd!==undefined)closeSync(fd);}
}
export function loadCommittedFixture(path:string):CommittedFixture{try{return parseBytes(protectedFixtureBytes(path),FROZEN_FIXTURE,'PRODUCTION');}catch{throw Error('w2_operator_private_fixture_HOLD');}}
/** Test-only explicit local path/binding. Its handle remains LOCAL_MOCK and can
 * never satisfy a production operator's fixture-mode check. */
export function loadLocalMockFixture(path:string,binding:Binding):CommittedFixture{try{return parseBytes(protectedFixtureBytes(path,realpathSync(tmpdir())),binding,'LOCAL_MOCK');}catch{throw Error('w2_operator_private_fixture_HOLD');}}
/** Explicit local/mock constructor cannot produce a production fixture handle. */
export function createLocalMockFixture(bytes:Uint8Array,binding:Binding):CommittedFixture{return parseBytes(bytes,binding,'LOCAL_MOCK');}
/** Byte-exact PostgreSQL jsonb serialization for the finite answer domain:
 * UUID object keys and scale integers0..4 or validated synthetic text only. */
export function postgresAnswerJSONB(answers:Record<string,string|number>):string{
 assertData(answers);need(Object.getPrototypeOf(answers)===Object.prototype&&Object.keys(answers).length===84,'fixture_jsonb_answers');return '{'+Object.keys(answers).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>{const v=answers[k];need(UUID.test(k)&&(typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=4||typeof v==='string'&&v.length>0&&v.length<=10000&&!/[\u0000\uD800-\uDFFF]/u.test(v)),'fixture_jsonb_value');return JSON.stringify(k)+': '+JSON.stringify(v);}).join(', ')+'}';
}
export function fixtureAnswerExpectation(handle:CommittedFixture,participantId:string,authorization:string){
 const v=owned.get(handle);need(v&&(PARTICIPANTS as readonly string[]).includes(participantId),'owned_private_fixture');need(/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization),'existing_authorization_only');const assignment=v.assignment.find(p=>p.participantId===participantId)!,profile=v.profiles.find(p=>p.abstractProfile===assignment.abstractProfile)!;const answers=Object.fromEntries(profile.controls.map(c=>[c.questionId,c.tagName==='SELECT'?Number(c.value):c.value]));const pk='{"participant_id": '+JSON.stringify(participantId)+'}';const message='aca-w2-preservation-v1\ncell\nprivate.team_responses\n'+pk+'\nanswers\n'+postgresAnswerJSONB(answers);const answersHMAC=createHmac('sha256',Buffer.from(authorization,'utf8')).update(message,'utf8').digest('hex');return Object.freeze({answersHMAC,count:84 as const,fixtureCommitmentSHA256:handle.assignmentCommitmentSHA256,rawMappingSaltAnswersReturned:false as const});
}
