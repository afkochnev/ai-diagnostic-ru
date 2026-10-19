import { readFileSync,lstatSync } from "node:fs";
import { homedir } from "node:os";
import { inspectResearchPrivacy } from "../src/server/team/quality/privacy-policy";
import { privacyCorpusSchema,type PrivacyCorpus } from "../src/server/team/synthesis-privacy";
import { teamReportInputV2Schema,parseQualitativeInputV2 } from "../src/server/team/report-v2-contracts";
import { buildDossier } from "../src/server/team/quality/dossier";

export const FOODTECH={project:"vflgxgdwlftlyjslyrmo",team:"faa8e71b-b2dc-4dd8-a222-2b7d58d75e23",company:"1a4e564d-95e2-4ae1-865f-266cde5f28f9",owner:"audit_1@iteam.ru"} as const;
export type Query=(sql:string)=>Promise<Record<string,unknown>[]>;
export function readPrivateManagementCredential() {
  const path=homedir()+"/.supabase/access-token",s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw new Error("foodtech_private_auth_required");
  const token=readFileSync(path,"utf8").trim();
  if(!/^sbp_[A-Za-z0-9_-]+$/.test(token))throw new Error("foodtech_private_auth_required");
  return token;
}
export function privateManagementQuery(fetcher:typeof fetch=fetch,readCredential:()=>string=readPrivateManagementCredential) {
  let token=readCredential();
  const query:Query=async sql=>{
    if(!token||Buffer.byteLength(sql)>500000)throw new Error("foodtech_source_unavailable");
    const statement=sql.trim().replace(/;\s*$/u,"");
    // These local scripts issue one SELECT/CTE only. Output values use hex literals.
    // An explicit read-only transaction preserves private-schema access while the
    // Management API's restricted read-only role cannot read the worker-only source.
    if(!/^(?:select|with)\s/iu.test(statement)||/[;]/u.test(statement)||/\b(?:commit|rollback|set|alter|drop|create|insert|update|delete|grant|revoke|copy|call)\b/iu.test(statement))throw new Error("foodtech_readonly_query_required");
    try{
      const r=await fetcher(`https://api.supabase.com/v1/projects/${FOODTECH.project}/database/query`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({query:`begin transaction isolation level repeatable read read only; ${statement}; rollback;`,read_only:false})});
      if(!r.ok)throw new Error();
      const text=await r.text();if(Buffer.byteLength(text)>2000000)throw new Error();
      const data=JSON.parse(text);if(!Array.isArray(data))throw new Error();return data;
    }catch{throw new Error("foodtech_source_unavailable");}
  };
  return {query,close(){token="";}};
}
export function compareSource(actual:Record<string,unknown>,expected:Record<string,unknown>) {
  for(const key of ["id","company_id","account_id","owner_email","status","completed_count","fingerprint","question_count","reports_count","historical_reports_guard","response_guard","validator_md5"])
    if(actual[key]!==expected[key])throw new Error("foodtech_source_changed");
  if(actual.id!==FOODTECH.team||actual.company_id!==FOODTECH.company||actual.owner_email!==FOODTECH.owner||actual.completed_count!==3||actual.question_count!==80||actual.validator_md5!=="e4d4af7584217930c88a370d45f80b7e")throw new Error("foodtech_source_changed");
}
export function foodtechSource(query:Query,expected:Record<string,unknown>) {
  let loadedCorpus:PrivacyCorpus|null=null;
  const metadataSql=readFileSync("scripts/sql/foodtech-quality-readiness.sql","utf8");
  const metadata=async()=>{const rows=await query(metadataSql);if(rows.length!==1)throw new Error("foodtech_source_changed");compareSource(rows[0],expected);return rows[0];};
  const evidenceSql=`with t as (select '${FOODTECH.team}'::uuid id), e as materialized(select private.team_numeric_evidence_v2(id) v from t),
    c as materialized(select private.safe_team_json(t.id,r.company_context_snapshot) v from t join public.team_ai_reports r on r.team_diagnostic_id=t.id where r.id='81d95807-69eb-4618-8f89-76cc322bbe47'::uuid),
    groups as (select q.pos,q.item,count(*) n,jsonb_agg(private.mask_team_text(t.id,r.answers->>(q.item->>'id')) order by random()) texts
      from t join private.team_questionnaires tq on tq.team_diagnostic_id=t.id cross join lateral jsonb_array_elements(tq.questions) with ordinality q(item,pos) cross join lateral private.team_completed(t.id) r
      where q.item->>'answer_type'='text' and nullif(btrim(r.answers->>(q.item->>'id')),'') is not null group by q.pos,q.item having count(*)>=3)
    select jsonb_build_object('aggregates',jsonb_build_object('participant_count',3,'company_context',c.v,'methodology',e.v->'methodology','overall',e.v->'overall','blocks',e.v->'blocks','questions',(select jsonb_agg(q-'_question_id' order by ord) from jsonb_array_elements(e.v->'questions') with ordinality x(q,ord))),
      'qualitative',jsonb_build_object('company_context',c.v,'block_aggregates',e.v->'blocks','groups',coalesce((select jsonb_agg(jsonb_build_object('question',item->>'prompt','question_position',pos,'block_title',item->>'block_title','response_count',n,'texts',texts,'relevant_block',(select b from jsonb_array_elements(e.v->'blocks') b where b->>'title'=item->>'block_title')) order by pos) from groups),'[]'::jsonb)),
      'corpus',jsonb_build_object('threshold',32,'answers',coalesce((select jsonb_agg(jsonb_build_object('question_index',q.pos,'text',v.value#>>'{}') order by q.pos,random()) from t join public.team_participants p on p.team_diagnostic_id=t.id join private.team_responses r on r.participant_id=p.id cross join lateral jsonb_each(r.answers) v join private.team_questionnaires tq on tq.team_diagnostic_id=t.id cross join lateral jsonb_array_elements(tq.questions) with ordinality q(item,pos) where jsonb_typeof(v.value)='string' and q.item->>'id'=v.key and q.item->>'answer_type'='text'),'[]'::jsonb),
      'identifiers',coalesce((select jsonb_agg(distinct value) from t join public.team_participants p on p.team_diagnostic_id=t.id left join private.team_responses r on r.participant_id=p.id cross join lateral (values(p.display_name),(p.email),(p.id::text),(r.user_id::text)) ids(value) where nullif(value,'') is not null),'[]'::jsonb))) value from e cross join c;`;
  return {metadata,
    async load(){
      await metadata();const rows=await query(evidenceSql);
      if(rows.length!==1||!rows[0].value||typeof rows[0].value!=="object")throw new Error("foodtech_source_unavailable");
      const v=rows[0].value as Record<string,unknown>,aggregates=teamReportInputV2Schema.parse(v.aggregates),qualitative=parseQualitativeInputV2(v.qualitative),corpus=privacyCorpusSchema.parse(v.corpus);
      buildDossier(aggregates,qualitative);if(qualitative.groups.length!==4||qualitative.groups.some(g=>g.response_count!==3))throw new Error("foodtech_source_changed");
      loadedCorpus=corpus;await metadata();return {aggregates,qualitative,corpus};
    },
    async validateUnattributed(value:unknown){
      await metadata();if(!loadedCorpus)throw new Error("foodtech_source_unavailable");
      if(inspectResearchPrivacy(value,loadedCorpus,"unattributed").policyViolation)throw new Error("team_privacy_rejected");
      await metadata();
    },
    async validate(value:unknown){
      await metadata();
      // SQL and generated output stay in process memory, never in CLI args/files/logs.
      const literal=Buffer.from(JSON.stringify(value)).toString("hex");
      try{await query(`select private.validate_team_output('${FOODTECH.team}'::uuid,convert_from(decode('${literal}','hex'),'UTF8')::jsonb) as checked;`);}catch{throw new Error("quality_db_rejected");}
      await metadata();
    },
  };
}
