begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select is((select count(*)::int from public.diagnostic_versions where version_number = 1 and status = 'published'), 1, 'RU-1.0 remains published');
select is((select count(*)::int from public.diagnostic_versions where version_number = 2 and status = 'published'), 1, 'RU-2.0 is restored and published');
select is((select count(*)::int from public.diagnostic_versions where version_number = 4 and status = 'published'), 1, 'corrected RU-2.1 is published as version 4');
select is((select count(*)::int from public.diagnostic_blocks b join public.diagnostic_versions v on v.id=b.version_id where v.version_number=2 and b.weight > 0), 8, 'RU-2.0 has eight scoring blocks');
select is((select count(*)::int from public.questions q join public.diagnostic_versions v on v.id=q.version_id where v.version_number=2 and q.weight > 0), 80, 'RU-2.0 has eighty scoring questions');
select is((select count(*)::int from public.questions q join public.diagnostic_versions v on v.id=q.version_id where v.version_number=4 and q.weight > 0), 80, 'RU-2.1 has eighty scoring questions');
select is((select count(*)::int from public.questions q join public.diagnostic_blocks b on b.id=q.block_id join public.diagnostic_versions v on v.id=q.version_id where v.version_number=4 and b.key in ('company_info','open_questions')), 4, 'RU-2.1 has four non-scoring questions');
select is((select count(*)::int from public.questions q2 join public.question_translations t2 on t2.question_id=q2.id and t2.locale='ru' join public.diagnostic_blocks b2 on b2.id=q2.block_id join public.diagnostic_versions v2 on v2.id=q2.version_id join public.questions q4 on q4.key=q2.key and q4.position=q2.position join public.question_translations t4 on t4.question_id=q4.id and t4.locale='ru' join public.diagnostic_blocks b4 on b4.id=q4.block_id and b4.key=b2.key join public.diagnostic_versions v4 on v4.id=q4.version_id where v2.version_number=2 and v4.version_number=4 and t2.prompt<>t4.prompt), 1, 'RU-2.1 differs in one question');
select is((select t4.prompt from public.question_translations t4 join public.questions q4 on q4.id=t4.question_id join public.diagnostic_blocks b4 on b4.id=q4.block_id join public.diagnostic_versions v4 on v4.id=q4.version_id where v4.version_number=4 and b4.key='structure' and q4.position=3 and t4.locale='ru'), 'В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.', 'RU-2.1 grammar correction is exact');
select is((select max(version_number)::int from public.diagnostic_versions where status='published'), 4, 'version 4 is current published methodology');

select * from finish();
rollback;
