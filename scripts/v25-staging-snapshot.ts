/** Staging only. Protected rows never leave PostgreSQL: only IDs, counts and hashes. */
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,sep} from "node:path";
import {privateManagementQuery} from "./foodtech-quality-source";
async function main(){
const allowed=resolve("../artifacts/v25-anonymous-conversion"),target=resolve(process.argv[2]??"");
if(!target.startsWith(allowed+sep)||!/^staging-protected-[a-z0-9-]+\.json$/.test(target.slice(allowed.length+1)))throw Error("v25_snapshot_target_rejected");
const source=privateManagementQuery();
try{
 const tables=await source.query("select schemaname,tablename from pg_tables where schemaname in('public','private') or (schemaname='auth' and tablename in('users','identities')) order by schemaname,tablename");
 const parts=tables.map(t=>{
  const schema=String(t.schemaname),table=String(t.tablename);if(!/^[a-z_]+$/.test(schema)||!(/^[a-z0-9_]+$/).test(table))throw Error("v25_snapshot_table_rejected");
  const body=schema==='auth'?"(to_jsonb(r)-'last_sign_in_at'-'updated_at')":"to_jsonb(r)";
  const hash="encode(sha256(convert_to("+body+"::text,'UTF8')),'hex')";
  return "select '"+schema+'.'+table+"' table_name,count(*) row_count,coalesce(jsonb_object_agg(coalesce(to_jsonb(r)->>'id',"+hash+"),"+hash+"),'{}'::jsonb) rows from \""+schema+'"."'+table+'" r';
 });
 const query="select jsonb_build_object('project','vflgxgdwlftlyjslyrmo','captured_at',now(),'tables',(select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'rows',rows)) from ("+parts.join(' union all ')+") snapshots),'ledger',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations)) snapshot";
 const rows=await source.query(query);if(rows.length!==1||!rows[0].snapshot)throw Error("v25_snapshot_failed");
 mkdirSync(allowed,{recursive:true,mode:0o700});writeFileSync(target,JSON.stringify({scope:"Consistent repeatable-read staging snapshot; Auth sign-in timestamps excluded, credentials/identity content still hashed; session/refresh-token operational tables excluded",...rows[0].snapshot as object},null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:"CAPTURED",project:"vflgxgdwlftlyjslyrmo",tables:tables.length,path:target,productionTouched:false}));
}finally{source.close();}
}
void main().catch(()=>{console.error("v25_snapshot_failed");process.exitCode=1;});
