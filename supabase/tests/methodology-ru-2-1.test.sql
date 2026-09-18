begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is((select count(*)::int from public.diagnostic_versions where version_number = 3 and status = 'published'), 1, 'RU-2.1 is published exactly once');
select is((select count(*)::int from public.diagnostic_blocks b join public.diagnostic_versions v on v.id=b.version_id where v.version_number=3 and b.weight > 0), 8, 'RU-2.1 has eight scoring blocks');
select is((select count(*)::int from public.questions q join public.diagnostic_versions v on v.id=q.version_id where v.version_number=3 and q.weight > 0), 80, 'RU-2.1 has eighty scoring questions');
select is((select count(*)::int from public.questions q join public.diagnostic_blocks b on b.id=q.block_id join public.diagnostic_versions v on v.id=q.version_id where v.version_number=3 and b.key='company_info'), 2, 'RU-2.1 has two general information questions');
select is((select count(*)::int from public.questions q join public.diagnostic_blocks b on b.id=q.block_id join public.diagnostic_versions v on v.id=q.version_id where v.version_number=3 and b.key='open_questions'), 2, 'RU-2.1 has two open questions');
select is((select count(*)::int from public.questions q3 join public.diagnostic_blocks b3 on b3.id=q3.block_id join public.diagnostic_versions v3 on v3.id=q3.version_id join public.questions q2 on q2.position=q3.position join public.diagnostic_blocks b2 on b2.id=q2.block_id and b2.key=b3.key join public.diagnostic_versions v2 on v2.id=q2.version_id where v3.version_number=3 and v2.version_number=2 and b3.key='structure' and q3.position=3 and q2.position=3 and exists (select 1 from public.question_translations t3 join public.question_translations t2 on t2.locale=t3.locale where t3.question_id=q3.id and t2.question_id=q2.id and t3.prompt<>t2.prompt)), 1, 'Only Organizational Structure question 3 differs');
select is((select prompt from public.question_translations t join public.questions q on q.id=t.question_id join public.diagnostic_blocks b on b.id=q.block_id join public.diagnostic_versions v on v.id=q.version_id where v.version_number=3 and b.key='structure' and q.position=3 and t.locale='ru'), 'В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.', 'RU-2.1 grammar correction is exact');
select is((select count(*)::int from public.diagnostic_versions where version_number in (1,2) and status='published'), 2, 'RU-1.0 and RU-2.0 remain published');

select * from finish();
rollback;
