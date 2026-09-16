-- Stage 12.1: publish a new methodology version without mutating RU-1.0.
begin;
do $$
declare
  v_definition uuid;
  v_old_version uuid := '656e05fd-66c4-50bf-908f-53565525dd5a';
  v_version uuid := 'c5d7b1d0-1f4f-4e93-8af6-12b7d0e2f201';
begin
  select id into v_definition from public.diagnostic_definitions where key = 'manageability';
  if v_definition is null then raise exception 'manageability definition missing'; end if;
  insert into public.diagnostic_versions (id,definition_id,version_number,status,content_hash,source_file,published_at)
  values (v_version,v_definition,2,'published','stage12-1-mvp-question-bank-v2','METHODOLOGY_RU_2_0.csv',now())
  on conflict (definition_id,version_number) do nothing;
  insert into public.diagnostic_version_translations (version_id,locale,title,description)
  values (v_version,'ru','Диагностика управляемости компании','Методика RU-2.0') on conflict do nothing;
  create temporary table _stage12_blocks(old_id uuid primary key,new_id uuid not null,key text not null,position integer not null) on commit drop;
  insert into _stage12_blocks select id,gen_random_uuid(),key,position from public.diagnostic_blocks where version_id=v_old_version;
  insert into public.diagnostic_blocks (id,version_id,key,position,weight,is_active)
  select m.new_id,v_version,b.key,b.position,b.weight,b.is_active from _stage12_blocks m join public.diagnostic_blocks b on b.id=m.old_id;
  insert into public.diagnostic_block_translations (block_id,locale,title,description)
  select m.new_id,t.locale,case b.key when 'strategy' then 'Стратегия' when 'structure' then 'Организационная структура' when 'processes' then 'Процессы и операционная эффективность' when 'goals_kpi' then 'Цели и показатели' when 'management_rhythm' then 'Управленческий ритм' when 'team' then 'Зрелость команды' when 'motivation' then 'Инновации и развитие' when 'culture' then 'Корпоративная культура' else t.title end,t.description
  from _stage12_blocks m join public.diagnostic_blocks b on b.id=m.old_id join public.diagnostic_block_translations t on t.block_id=m.old_id;
  create temporary table _stage12_questions(old_id uuid primary key,new_id uuid not null,key text not null) on commit drop;
  insert into _stage12_questions select q.id,gen_random_uuid(),q.key from public.questions q where q.version_id=v_old_version;
  insert into public.questions (id,version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score,legacy_ai_context_label,legacy_bubble_unique_id)
  select m.new_id,v_version,b.new_id,q.key,q.position,q.answer_type,q.weight,q.is_required,q.is_active,q.reverse_score,q.legacy_ai_context_label,q.legacy_bubble_unique_id from _stage12_questions m join public.questions q on q.id=m.old_id join _stage12_blocks b on b.old_id=q.block_id;
  insert into public.question_translations (question_id,locale,prompt,help_text)
  select q2.new_id,t.locale,t.prompt,t.help_text from _stage12_questions q2 join public.question_translations t on t.question_id=q2.old_id;
  update public.question_translations t set prompt='Какую главную управленческую проблему Вы хотите решить в ближайшие 3–6 месяцев? Опишите ее причины и объясните, почему Вы ставите ей высший приоритет (Ваши развернутые ответы позволят сделать отчет более содержательным).'
  from public.questions q where t.question_id=q.id and q.version_id=v_version and q.key='main_management_problem' and t.locale='ru';
  insert into public.question_options (id,question_id,key,position,score_value)
  select gen_random_uuid(),q2.new_id,o.key,o.position,o.score_value from _stage12_questions q2 join public.question_options o on o.question_id=q2.old_id;
  insert into public.question_option_translations (option_id,locale,label)
  select o2.id,t.locale,t.label from public.question_options o2 join _stage12_questions q2 on q2.new_id=o2.question_id join public.question_options old_o on old_o.question_id=q2.old_id and old_o.key=o2.key join public.question_option_translations t on t.option_id=old_o.id;
  insert into public.scoring_policies (version_id,engine_key,engine_version,schema_version,configuration,policy_hash)
  select v_version,engine_key,engine_version,schema_version,configuration,'stage12-1-mvp-question-bank-v2' from public.scoring_policies where version_id=v_old_version;
end $$;
commit;
