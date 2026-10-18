-- Disposable local DB only: copy the accepted 8/80/4 methodology and add a reverse-coded case.
do $$
declare src uuid; v uuid:=gen_random_uuid(); oldb record; oldq record; bid uuid; qid uuid;
begin
 select id into strict src from public.diagnostic_versions where version_number=4;
 insert into public.diagnostic_versions(id,definition_id,version_number,status,content_hash,source_file)
 select v,definition_id,100,'draft','v22c-local-reverse-evidence','LOCAL ONLY' from public.diagnostic_versions where id=src;
 for oldb in select * from public.diagnostic_blocks where version_id=src order by position loop
  bid:=gen_random_uuid();
  insert into public.diagnostic_blocks(id,version_id,key,position,weight,is_active) values(bid,v,oldb.key,oldb.position,oldb.weight,oldb.is_active);
  insert into public.diagnostic_block_translations select bid,locale,title,description from public.diagnostic_block_translations where block_id=oldb.id;
  for oldq in select * from public.questions where block_id=oldb.id order by position loop
   qid:=gen_random_uuid();
   insert into public.questions(id,version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score)
   values(qid,v,bid,oldq.key,oldq.position,oldq.answer_type,oldq.weight,oldq.is_required,oldq.is_active,
    case when oldq.answer_type='scale_0_4' and oldq.position=2 then true else oldq.reverse_score end);
   insert into public.question_translations select qid,locale,prompt,help_text from public.question_translations where question_id=oldq.id;
   insert into public.question_options(question_id,key,position,score_value) select qid,key,position,score_value from public.question_options where question_id=oldq.id;
   insert into public.question_option_translations select n.id,t.locale,t.label from public.question_options n
    join public.question_options o on o.question_id=oldq.id and o.key=n.key join public.question_option_translations t on t.option_id=o.id where n.question_id=qid;
  end loop;
 end loop;
 insert into public.scoring_policies(version_id,engine_key,engine_version,schema_version,configuration,policy_hash)
 select v,engine_key,engine_version,schema_version,configuration,'v22c-local-reverse-evidence' from public.scoring_policies where version_id=src;
 insert into public.maturity_levels(version_id,key,position,classification_config) select v,key,position,classification_config from public.maturity_levels where version_id=src;
 insert into public.maturity_level_translations select n.id,t.locale,t.label,t.description from public.maturity_levels n
 join public.maturity_levels o on o.version_id=src and o.key=n.key join public.maturity_level_translations t on t.maturity_level_id=o.id where n.version_id=v;
 update public.diagnostic_versions set status='published' where id=v;
end $$;
