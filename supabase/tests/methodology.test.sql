begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select is((select count(*)::int from public.diagnostic_blocks where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1)),10,'RU-1.0 has exactly ten blocks');
select is((select count(*)::int from public.questions where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1)),84,'RU-1.0 has exactly 84 questions');
select is((select count(*)::int from public.questions where answer_type='scale_0_4'),80,'RU-1.0 has 80 scale questions');
select is((select count(*)::int from public.questions where answer_type='text'),4,'RU-1.0 has four text questions');
select is((select count(*)::int from public.questions where is_required),82,'RU-1.0 required metadata is preserved');
select is((select count(*)::int from public.questions where not is_required),2,'RU-1.0 optional metadata is preserved');
select is((select count(*)::int from public.questions where is_active),84,'All RU-1.0 questions are active');
select is((select count(*)::int from public.questions where reverse_score=false),84,'All RU-1.0 reverse flags are false');
select is((select string_agg(key,',' order by position) from public.diagnostic_blocks where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1)),'company_info,strategy,structure,processes,goals_kpi,management_rhythm,team,motivation,culture,open_questions','Block order is pinned');
select is((select count(*)::int from public.questions where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1) and weight=1),80,'Scale weights are one');
select is((select count(*)::int from public.diagnostic_blocks where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1) and weight=1),8,'Eight scored block weights are one');
select is((select count(*)::int from public.diagnostic_blocks where version_id=(select id from public.diagnostic_versions where status='published' and version_number=1) and weight=0),2,'Context block weights are zero');
select is((select prompt from public.question_translations where question_id=(select id from public.questions where key='main_management_problem')),'Какую главную управленческую проблему вы хотите решить в ближайшие 3 месяца? Почему Вы ставите ей высший приоритет?','Exact approved question text is imported');
select is((select count(*)::int from public.questions q join public.question_options o on o.question_id=q.id where q.answer_type='scale_0_4'),400,'Scale options are stored separately');
select is((select string_agg(label,',' order by o.position) from public.question_option_translations t join public.question_options o on o.id=t.option_id join public.questions q on q.id=o.question_id where q.key='strategy_clarity' and t.locale='ru'),'1,2,3,4,5','User-facing scale is one to five while options store zero to four');

select * from finish();
rollback;
