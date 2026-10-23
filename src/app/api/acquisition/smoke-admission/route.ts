import {NextResponse} from 'next/server';
import {freeSmokeConfig,freeSmokeAdmission,freeSmokeCookie} from '@/server-runtime/free-smoke';
import {acquisitionEnabled} from '@/server/acquisition/contracts';
import {acquisitionJson} from '@/server/acquisition/request';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const config=freeSmokeConfig();
  if(!config||!acquisitionEnabled())return NextResponse.json({error:'unavailable'},{status:404});
  if(request.headers.get('origin')!=='https://audit.iteam.ru')return NextResponse.json({error:'unavailable'},{status:403});
  const input=await acquisitionJson(request,256);
  if(!input||typeof input!=='object'||Object.keys(input).length!==1||!('admission'in input)||typeof input.admission!=='string'||!freeSmokeAdmission(input.admission))return NextResponse.json({error:'unavailable'},{status:403});
  const response=NextResponse.json({ok:true});
  response.cookies.set(freeSmokeCookie,input.admission,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:Math.max(1,Math.floor((config.expires-Date.now())/1000))});
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
 }catch{return NextResponse.json({error:'unavailable'},{status:403});}
}
