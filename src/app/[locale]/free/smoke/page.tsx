import {notFound} from 'next/navigation';
import {freeSmokeConfig} from '@/server-runtime/free-smoke';
import {acquisitionEnabled} from '@/server/acquisition/contracts';
import {SmokeAdmission} from '@/features/acquisition/smoke-admission';
export const dynamic='force-dynamic';
export default function Page(){
 try{if(!freeSmokeConfig()||!acquisitionEnabled())notFound();}catch{notFound();}
 return <main className="mx-auto max-w-2xl px-5 py-10"><h1 className="text-2xl font-semibold">Диагностика компании</h1><SmokeAdmission/></main>;
}
