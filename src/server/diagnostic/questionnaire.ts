import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/types/database.generated';
import {openQuestionHint} from './profile-prefill';
export type QuestionnaireAnswer={question_id:string;text_value:string|null;numeric_value:number|null;revision:number};
/** Both entry paths read the same pinned methodology and translation/option semantics. */
export async function loadQuestionnaire(client:SupabaseClient<Database>,versionId:string,answers:QuestionnaireAnswer[]){
 const [{data:blocks},{data:blockTranslations},{data:questions},{data:questionTranslations},{data:options},{data:optionTranslations}]=await Promise.all([
  client.from('diagnostic_blocks').select('id,key,position,weight,is_active').eq('version_id',versionId).eq('is_active',true).order('position'),
  client.from('diagnostic_block_translations').select('block_id,title,description').eq('locale','ru'),
  client.from('questions').select('id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score').eq('version_id',versionId).eq('is_active',true).order('position'),
  client.from('question_translations').select('question_id,prompt,help_text').eq('locale','ru'),
  client.from('question_options').select('id,question_id,key,position,score_value').order('position'),
  client.from('question_option_translations').select('option_id,label').eq('locale','ru')]);
 if(!blocks?.length||!questions?.length)throw Error('questionnaire_unavailable');
 const bt=new Map((blockTranslations??[]).map(r=>[r.block_id,r])),qt=new Map((questionTranslations??[]).map(r=>[r.question_id,r])),ot=new Map((optionTranslations??[]).map(r=>[r.option_id,r.label])),am=new Map(answers.map(r=>[r.question_id,r]));
 return blocks.map(b=>({...b,title:bt.get(b.id)?.title??b.key,questions:questions.filter(q=>q.block_id===b.id).sort((a,b)=>a.position-b.position).map(q=>({...q,prompt:qt.get(q.id)?.prompt??'',help_text:qt.get(q.id)?.help_text||openQuestionHint(q.key),options:(options??[]).filter(o=>o.question_id===q.id).map(o=>({id:o.id,position:o.position,score_value:o.score_value,label:ot.get(o.id)??String(o.position)})),answer:am.get(q.id)??null}))}));
}
export type QuestionnaireBlocks=Awaited<ReturnType<typeof loadQuestionnaire>>;
