import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {buildReviewedTeamPdfHtml,renderReviewedTeamPdf,type TeamPdfInput} from "../src/server/team/pdf-render";
import {classifyDispersion,DISPERSION_INTERPRETATION_VERSION} from "../src/shared/analytics/dispersion";
const base=resolve("../artifacts"),out=join(base,"v22c4-report-presentation");
async function main(){
 const source=join(base,"v22c4-team-report-quality/foodtech-corrected-report-20261020/FoodTech_report_corrected.json"),numeric=join(base,"v22c4-team-report-quality/foodtech-numeric-audit-20261020/verified-program-results.json"),content=JSON.parse(readFileSync(source,"utf8")),a=JSON.parse(readFileSync(numeric,"utf8"));
 if(a.status!=="INDEPENDENT_RECALCULATION_MATCHES_PROGRAM_AND_AI_INPUT"||a.questions.length!==80||a.blocks.length!==8)throw Error("presentation_source_not_verified");
 const before=JSON.stringify(content),hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
 const input:TeamPdfInput={companyName:"FoodTech",teamTitle:"Диагностика системы управления FoodTech",completedAt:"2026-10-20T12:00:00Z",participantCount:a.completedParticipants,index:a.overall.displayMean,maturity:a.overall.maturity,blocks:a.blocks.map((b:{title:string;displayMean:string})=>({title:b.title,score:b.displayMean})),content,mock:false,profile:{participantCount:a.completedParticipants,overall:{mean:a.overall.uiMean,stddev:a.overall.uiStddev,maturity:a.overall.maturity},blocks:a.blocks.map((b:{position:number;title:string;uiMean:number;uiStddev:number})=>({position:b.position,title:b.title,mean:b.uiMean,stddev:b.uiStddev})),questions:a.questions.map((q:{questionnaire_number:number;position:number;block_position:number;block_title:string;question:string;uiMean:number;uiStddev:number;participant_count:number})=>({number:q.questionnaire_number,position:q.position,blockPosition:q.block_position,blockTitle:q.block_title,question:q.question,mean:q.uiMean,stddev:q.uiStddev,participantCount:q.participant_count}))}};
 mkdirSync(out,{recursive:true,mode:0o700});const html=buildReviewedTeamPdfHtml(input),bytes=await renderReviewedTeamPdf(input);
 if(JSON.stringify(content)!==before||JSON.stringify(JSON.parse(readFileSync(source,"utf8")))!==before)throw Error("presentation_content_changed");
 writeFileSync(join(out,"foodtech-branded-report.html"),html,{mode:0o600});writeFileSync(join(out,"foodtech-branded-report.pdf"),bytes,{mode:0o600});
 const profile=input.profile!,rows=[{title:"Общий индекс",...profile.overall},...profile.blocks].map(r=>({...r,interpretation:classifyDispersion(r.stddev,100)}));
 const expected=["moderate","high","moderate","moderate","high","moderate","moderate","moderate","moderate"];
 if(rows.some((r,i)=>r.interpretation.key!==expected[i]))throw Error("presentation_regression_failed");
 const regression={status:"PASS",interpretationVersion:DISPERSION_INTERPRETATION_VERSION,rows,questions:profile.questions.map(q=>({number:q.number,mean:q.mean,stddev:q.stddev,interpretation:classifyDispersion(q.stddev,4)})),questionCount:80,blockCount:8,contentSHA256Before:hash(before),contentSHA256After:hash(JSON.stringify(content)),contentPreserved:true,pdfSHA256:hash(bytes),numericSourceSHA256:hash(readFileSync(numeric)),externalAIRequests:0,sourceReport:source};
 writeFileSync(join(out,"foodtech-dispersion-regression.json"),JSON.stringify(regression,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({status:regression.status,questionCount:80,blockCount:8,pdfSHA256:regression.pdfSHA256,externalAIRequests:0}));
}
void main().catch(()=>{console.error("PRESENTATION_RENDER_FAILED_NO_PRIVATE_PAYLOAD");process.exitCode=1;});
