import 'server-only';
import {cookies} from 'next/headers';
import {freeSmokeConfig,freeSmokeAdmission,freeSmokeCookie,reserveFreeSmokeBudget} from '@/server-runtime/free-smoke';
export async function requireFreeSmokeAdmission(email?:string){
 const config=freeSmokeConfig();if(!config)return;
 if(email!==undefined&&(email!==config.email||process.env.ACQUISITION_EMAIL_PROVIDER!=='resend'))throw Error('controlled_free_unavailable');
 if(!freeSmokeAdmission((await cookies()).get(freeSmokeCookie)?.value))throw Error('controlled_free_unavailable');
}
/** Check browser admission before consuming the runtime's shared reservation. */
export async function reserveFreeSmoke(kind:'start'|'email'){
 await requireFreeSmokeAdmission();
 await reserveFreeSmokeBudget(kind);
}
