-- Isolated LOCAL PostgreSQL fixture only. Never a deployable migration.
do $$
declare v uuid:=gen_random_uuid(); def uuid; b uuid; q uuid; j integer; i integer;
begin
 select definition_id into def from public.diagnostic_versions where version_number=4;
 insert into public.diagnostic_versions(id,definition_id,version_number,status,content_hash,source_file) values(v,def,100,'draft','local-weighted-golden','isolated fixture');
 for i in 1..2 loop
  b:=gen_random_uuid();insert into public.diagnostic_blocks(id,version_id,key,position,weight) values(b,v,'golden_'||i,i,case when i=1 then 1.5 else 3 end);
  insert into public.diagnostic_block_translations values(b,'ru','Синтетический блок '||i,null);
  for j in 1..2 loop
   q:=gen_random_uuid();insert into public.questions(id,version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score)
   values(q,v,b,'golden_'||i||'_'||j,j,'scale_0_4',case when j=1 then 1 else 3 end,true,true,i=1 and j=2);
   insert into public.question_translations values(q,'ru','Синтетический вопрос '||i||'/'||j,null);
   insert into public.question_options(question_id,key,position,score_value) select q,'v'||n,n+1,n from generate_series(0,4) n;
   insert into public.question_option_translations select id,'ru','Значение '||score_value from public.question_options where question_id=q;
  end loop;
 end loop;
 insert into public.scoring_policies(version_id,engine_key,engine_version,schema_version,configuration,policy_hash) values(v,'pending_stage_5','1','1','{}','local-weighted-golden');
 insert into public.maturity_levels(version_id,key,position,classification_config) select v,key,position,classification_config from public.maturity_levels where version_id=(select id from public.diagnostic_versions where version_number=4);
 insert into public.maturity_level_translations select n.id,'ru',o.label,null from public.maturity_levels n join public.maturity_levels old on old.key=n.key and old.version_id=(select id from public.diagnostic_versions where version_number=4) join public.maturity_level_translations o on o.maturity_level_id=old.id and o.locale='ru' where n.version_id=v;
 update public.diagnostic_versions set status='published' where id=v;
end $$;
