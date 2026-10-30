import type {SessionView} from './contracts';

export function sessionLoadFailure(error:unknown,hasCookie:boolean):'new'|'expired'|'unavailable'{
 if(!hasCookie)return 'new';
 return error instanceof Error && error.message==='acquisition_expired'?'expired':'unavailable';
}

// A reservation can precede a failed provider call. Only the latest accepted send
// should put the visitor in the "check your inbox" state after a page reload.
export function accessEmailSent(session:Pick<SessionView,'email_requested_at'|'email_sent_at'>){
 const requested=Date.parse(session.email_requested_at??''),sent=Date.parse(session.email_sent_at??'');
 return Number.isFinite(requested)&&Number.isFinite(sent)&&sent>=requested;
}

export function profileFromAnswers(questions:{id:string;key:string}[],answers:SessionView['answers'],draft:SessionView['company_context_draft']){
 const result:Record<string,string|number|null>={};
 for(const [questionKey,field] of [['main_management_problem','key_problems'],['main_company_goal','main_goals']] as const){
  const id=questions.find(q=>q.key===questionKey)?.id,value=id?answers[id]:undefined;
  if(typeof value==='string'&&value.trim())result[field]=value;
 }
 return {...result,...draft};
}
