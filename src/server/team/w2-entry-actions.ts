'use server';
import {cookies,headers} from 'next/headers';
import {authConfig} from '@/server/supabase/config';
import {teamFoundationEnabled} from './capabilities';
import {readControlledTeamW2Entry} from './w2-entry';

/** The only public W2 preparation action stores an already-issued sealed proof.
 * It cannot create/send credentials or consume a personal consent opportunity. */
export async function prepareControlledTeamAccessAction(_: {error?:string},form:FormData):Promise<{error?:string;status?:'prepared'}>{
 try{
  const config=authConfig();
  if(!teamFoundationEnabled()||(await headers()).get('origin')!==config.APP_URL)throw Error('team_context_expired');
  const envelope=String(form.get('access')??'');
  const {proof}=await readControlledTeamW2Entry(envelope,config.AUTH_FLOW_SECRET);
  const jar=await cookies();
  for(const name of ['team-invitation','team-invitation-details','team-email-challenge','team-invitation-auth'])jar.set(name,'',{httpOnly:true,sameSite:'lax',secure:config.secure,path:name==='team-invitation'||name==='team-invitation-details'?'/ru':'/ru/team',maxAge:0});
  jar.set('team-w2-access',envelope,{httpOnly:true,sameSite:'lax',secure:config.secure,path:'/ru/team',maxAge:Math.max(1,Math.floor((proof.expires-Date.now())/1000))});
  return {status:'prepared'};
 }catch{return {error:'Ссылка недоступна или срок доступа истёк. Обратитесь к организатору.'};}
}
