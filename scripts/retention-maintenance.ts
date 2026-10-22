import {readFileSync} from 'node:fs';
import {createAdminClient} from '../src/server-runtime/supabase/admin';

// Operator process, deliberately absent from web/worker automatic startup.
// The current acceptance authorizes staging only. Production fails closed.
async function main(){
const args=process.argv.slice(2);
if(args.some((x,i)=>!['--apply','--scope','--batch'].includes(x)&&!['--scope','--batch'].includes(args[i-1]??'')))throw Error('invalid_retention_arguments');
const apply=args.includes('--apply'),scopePath=args[args.indexOf('--scope')+1];
const batch=args.includes('--batch')?Number(args[args.indexOf('--batch')+1]):100;
if(process.env.APP_URL!=='https://ai-diagnostic-staging-web.onrender.com'||process.env.SUPABASE_URL!=='https://vflgxgdwlftlyjslyrmo.supabase.co')throw Error('staging_only');
if(!Number.isInteger(batch)||batch<1||batch>500)throw Error('invalid_batch');
const scope=args.includes('--scope')?JSON.parse(readFileSync(scopePath,'utf8')):null;
if(apply&&(!scope||typeof scope!=='object'||Array.isArray(scope)))throw Error('staging_fixture_scope_required');
const db=createAdminClient();
const preview=await db.rpc('run_retention_maintenance',{p_dry_run:true,p_batch_size:batch,p_scope:scope});
if(preview.error)throw Error('retention_preview_failed');
console.log(JSON.stringify(preview.data));
if(apply){
 const result=await db.rpc('run_retention_maintenance',{p_dry_run:false,p_batch_size:batch,p_scope:scope});
 if(result.error)throw Error('retention_apply_failed');
 console.log(JSON.stringify(result.data));
}

}
main().catch(()=>{console.error("retention_process_failed");process.exitCode=1;});
