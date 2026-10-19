import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes,createHash } from "node:crypto";
import { join } from "node:path";
import type { qualityCase } from "./fixtures/team-quality-cases";

const container="ai-diagnostic-v22c4-quality-local";
const literal=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
/** Exact unchanged production validator in an isolated disposable PostgreSQL schema.
 * This is privacy-validator parity, not a claim of full Supabase/RLS integration. */
export function createQualityDatabase() {
  const info=JSON.parse(execFileSync("docker",["inspect",container],{encoding:"utf8"}))[0];
  if(info.Config.Image!=="postgres:17-alpine"||info.Config.Labels["codex.task"]!=="v22c4"||info.HostConfig.NetworkMode!=="none"||Object.values(info.NetworkSettings.Ports).some(Boolean))throw new Error("quality_local_scope");
  const db="v22c4_"+randomBytes(8).toString("hex");let created=false;
  const sql=(query:string,database=db)=>{
    try{return execFileSync("docker",["exec","-i",container,"psql","-XqAt","-v","ON_ERROR_STOP=1","-U","postgres","-d",database],{input:query,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();}
    catch{throw new Error("quality_db_rejected");}
  };
  const close=()=>{if(created){sql(`drop database ${db}` ,"postgres");created=false;}};
  try{
    sql(`create database ${db}`,"postgres");created=true;
    sql(`create schema private;create table public.team_participants(id uuid primary key,team_diagnostic_id uuid,display_name text,email text);create table private.team_responses(participant_id uuid,user_id uuid,answers jsonb);create table private.team_questionnaires(team_diagnostic_id uuid,questions jsonb);`);
    const source=readFileSync(join(process.cwd(),"supabase/migrations/20261018105321_rich_team_ai_report_v2.sql"),"utf8");
    const fn=source.match(/create or replace function private\.validate_team_output\(p_team uuid,p_output jsonb\)[\s\S]*?end; \$\$;/)?.[0];
    if(!fn)throw new Error("quality_validator_missing");sql(fn);
    const fingerprint=sql("select md5(pg_get_functiondef('private.validate_team_output(uuid,jsonb)'::regprocedure))");
    if(fingerprint!=="e4d4af7584217930c88a370d45f80b7e")throw new Error("quality_validator_changed");
    return {fingerprint,load(f:ReturnType<typeof qualityCase>){
      const h=createHash("sha256").update(f.id).digest("hex"),team=`${h.slice(0,8)}-${h.slice(8,12)}-4000-8000-${h.slice(12,24)}`;
      const questions=f.qualitative.groups.map(g=>({id:String(g.question_position),answer_type:"text"}));
      sql(`insert into private.team_questionnaires values('${team}',${literal(questions)})`);
      for(let i=0;i<4;i++){
        const id=`20000000-0000-4000-8000-${String(Number.parseInt(h.slice(0,6),16)*10+i).padStart(12,"0")}`;
        const answers=Object.fromEntries(f.qualitative.groups.map(g=>[String(g.question_position),g.texts[i]]));
        sql(`insert into public.team_participants values('${id}','${team}','ЗакрытоеТестовоеИмя${i}','nobody${i}@example.test');insert into private.team_responses values('${id}',null,${literal(answers)})`);
      }
      return async(value:unknown)=>{sql(`select private.validate_team_output('${team}',${literal(value)})`);};
    },close};
  }catch(error){close();throw error;}
}
