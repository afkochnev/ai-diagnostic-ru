-- RU-2.1: clone immutable RU-2.0 and correct one Organizational Structure prompt.
begin;
do $$
declare
  v_definition uuid;
  v_old_version uuid := 'c5d7b1d0-1f4f-4e93-8af6-12b7d0e2f201';
  v_version uuid := 'd6e8c2e1-2f50-4f94-9b07-23c8d1f3a312';
begin
  select id into v_definition
  from public.diagnostic_definitions
  where key = 'manageability';
  if v_definition is null then raise exception 'manageability definition missing'; end if;

  insert into public.diagnostic_versions
    (id, definition_id, version_number, status, content_hash, source_file, published_at)
  values
    (v_version, v_definition, 3, 'draft', 'stage12-2-1-methodology-v3', 'METHODOLOGY_RU_2_1.csv', null);

  insert into public.diagnostic_version_translations (version_id, locale, title, description)
  select v_version, locale, title, 'Методика RU-2.1'
  from public.diagnostic_version_translations
  where version_id = v_old_version;

  create temporary table _ru21_blocks (
    old_id uuid primary key,
    new_id uuid not null,
    key text not null
  ) on commit drop;
  insert into _ru21_blocks
    select id, gen_random_uuid(), key
    from public.diagnostic_blocks
    where version_id = v_old_version;
  insert into public.diagnostic_blocks (id, version_id, key, position, weight, is_active)
    select m.new_id, v_version, b.key, b.position, b.weight, b.is_active
    from _ru21_blocks m
    join public.diagnostic_blocks b on b.id = m.old_id;
  insert into public.diagnostic_block_translations (block_id, locale, title, description)
    select m.new_id, t.locale, t.title, t.description
    from _ru21_blocks m
    join public.diagnostic_block_translations t on t.block_id = m.old_id;

  create temporary table _ru21_questions (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  insert into _ru21_questions
    select q.id, gen_random_uuid()
    from public.questions q
    where q.version_id = v_old_version;
  insert into public.questions
    (id, version_id, block_id, key, position, answer_type, weight, is_required, is_active,
     reverse_score, legacy_ai_context_label, legacy_bubble_unique_id)
    select m.new_id, v_version, b.new_id, q.key, q.position, q.answer_type, q.weight,
      q.is_required, q.is_active, q.reverse_score, q.legacy_ai_context_label,
      q.legacy_bubble_unique_id
    from _ru21_questions m
    join public.questions q on q.id = m.old_id
    join _ru21_blocks b on b.old_id = q.block_id;
  insert into public.question_translations (question_id, locale, prompt, help_text)
    select m.new_id, t.locale, t.prompt, t.help_text
    from _ru21_questions m
    join public.question_translations t on t.question_id = m.old_id;
  update public.question_translations t
    set prompt = 'В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.'
    from public.questions q
    join public.diagnostic_blocks b on b.id = q.block_id and b.version_id = q.version_id
    where t.question_id = q.id
      and q.version_id = v_version
      and b.key = 'structure'
      and q.position = 3
      and t.locale = 'ru';

  create temporary table _ru21_options (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  insert into _ru21_options
    select o.id, gen_random_uuid()
    from public.question_options o
    join _ru21_questions q on q.old_id = o.question_id;
  insert into public.question_options (id, question_id, key, position, score_value)
    select o.new_id, q.new_id, old_o.key, old_o.position, old_o.score_value
    from _ru21_options o
    join public.question_options old_o on old_o.id = o.old_id
    join _ru21_questions q on q.old_id = old_o.question_id;
  insert into public.question_option_translations (option_id, locale, label)
    select o.new_id, t.locale, t.label
    from _ru21_options o
    join public.question_option_translations t on t.option_id = o.old_id;

  insert into public.scoring_policies
    (version_id, engine_key, engine_version, schema_version, configuration, policy_hash)
    select v_version, engine_key, engine_version, schema_version, configuration,
      'stage12-2-1-methodology-v3'
    from public.scoring_policies
    where version_id = v_old_version;

  create temporary table _ru21_maturity (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;
  insert into _ru21_maturity
    select id, gen_random_uuid()
    from public.maturity_levels
    where version_id = v_old_version;
  insert into public.maturity_levels
    (id, version_id, key, position, classification_config)
    select m.new_id, v_version, old_m.key, old_m.position, old_m.classification_config
    from _ru21_maturity m
    join public.maturity_levels old_m on old_m.id = m.old_id;
  insert into public.maturity_level_translations
    (maturity_level_id, locale, label, description)
    select m.new_id, t.locale, t.label, t.description
    from _ru21_maturity m
    join public.maturity_level_translations t on t.maturity_level_id = m.old_id;

  update public.diagnostic_versions
    set status = 'published', published_at = now()
    where id = v_version and status = 'draft';
end $$;
commit;
