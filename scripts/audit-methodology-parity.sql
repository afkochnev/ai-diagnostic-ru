-- Read-only audit. Run unchanged against each environment with a schema-owner
-- connection; RLS-scoped responses are not sufficient to establish parity.
-- No record content from diagnostics/responses/reports is returned: only counts.
begin transaction isolation level repeatable read read only;

with recursive
versions as (
  select v.*, d.key as definition_key, to_jsonb(d) - 'id' - 'created_at' as definition
  from public.diagnostic_versions v
  join public.diagnostic_definitions d on d.id = v.definition_id
  where d.key = 'manageability'
),
foreign_keys as (
  select c.oid, c.conname::text collate "default" as conname, c.conrelid, c.confrelid,
    ns.nspname::text collate "default" as child_schema, child.relname::text collate "default" as child_table,
    pns.nspname::text collate "default" as parent_schema, parent.relname::text collate "default" as parent_table,
    c.conkey, c.confkey
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class child on child.oid = c.conrelid
  join pg_catalog.pg_namespace ns on ns.oid = child.relnamespace
  join pg_catalog.pg_class parent on parent.oid = c.confrelid
  join pg_catalog.pg_namespace pns on pns.oid = parent.relnamespace
  where c.contype = 'f' and ns.nspname in ('public', 'private')
),
-- Every descendant FK path is discovered, including composite keys and links
-- through questions/options/maturity/diagnostics/results/reports/jobs/leads.
-- A relation never repeats within one path; this prevents cyclic expansion.
paths(relation_oid, relation_schema, relation_name, depth, relations, constraints, from_sql) as (
  select 'public.diagnostic_versions'::regclass::oid, 'public'::text,
    'diagnostic_versions'::text, 0, array['public.diagnostic_versions'::regclass::oid],
    array[]::text[], 'public.diagnostic_versions t0'
  union all
  select fk.conrelid, fk.child_schema, fk.child_table, p.depth + 1,
    p.relations || fk.conrelid, p.constraints || fk.conname,
    (p.from_sql || format(' join %I.%I t%s on ', fk.child_schema, fk.child_table, p.depth + 1)
      || (
        select string_agg(format('t%s.%I = t%s.%I', p.depth + 1, ca.attname, p.depth, pa.attname), ' and ' order by k.ordinality)
        from unnest(fk.conkey, fk.confkey) with ordinality k(child_attnum, parent_attnum, ordinality)
        join pg_catalog.pg_attribute ca on ca.attrelid = fk.conrelid and ca.attnum = k.child_attnum
        join pg_catalog.pg_attribute pa on pa.attrelid = fk.confrelid and pa.attnum = k.parent_attnum
      )) collate "default"
  from paths p join foreign_keys fk on fk.confrelid = p.relation_oid
  where not fk.conrelid = any(p.relations)
),
scoped_paths as (
  select *, from_sql || ' where t0.id = (select v.id from public.diagnostic_versions v join public.diagnostic_definitions d on d.id = v.definition_id where d.key = ''manageability'' and v.version_number = 3)' as scoped_from_sql
  from paths
),
path_counts as (
  select *, ((xpath('/table/row/row_count/text()',
    query_to_xml('select count(*) as row_count from ' || scoped_from_sql, false, false, '')))[1]::text)::bigint as row_count
  from scoped_paths
),
table_queries as (
  select relation_schema, relation_name,
    string_agg(format('select t%s.ctid::text as row_identity from %s', depth, scoped_from_sql), ' union ' order by depth, from_sql) as union_sql
  from scoped_paths group by relation_schema, relation_name
),
table_counts as (
  -- UNION deduplicates rows that reference v3 by more than one FK path.
  select relation_schema, relation_name, ((xpath('/table/row/row_count/text()',
    query_to_xml('select count(*) as row_count from (' || union_sql || ') refs', false, false, '')))[1]::text)::bigint as row_count
  from table_queries
),
version_audits as (
  select v.version_number, jsonb_build_object(
    'version_number', v.version_number,
    'metadata', jsonb_build_object('id', v.id, 'definition_key', v.definition_key, 'status', v.status,
      'published_at', v.published_at, 'content_hash', v.content_hash, 'source_file', v.source_file),
    'counts', jsonb_build_object(
      'total_blocks', (select count(*) from public.diagnostic_blocks b where b.version_id = v.id),
      'scoring_blocks', (select count(*) from public.diagnostic_blocks b where b.version_id = v.id and b.weight > 0),
      'active_scoring_blocks', (select count(*) from public.diagnostic_blocks b where b.version_id = v.id and b.weight > 0 and b.is_active),
      'total_questions', (select count(*) from public.questions q where q.version_id = v.id),
      'scoring_questions', (select count(*) from public.questions q join public.diagnostic_blocks b on b.id = q.block_id where q.version_id = v.id and b.key not in ('company_info', 'open_questions') and q.weight > 0),
      'active_scoring_questions', (select count(*) from public.questions q join public.diagnostic_blocks b on b.id = q.block_id where q.version_id = v.id and b.weight > 0 and q.weight > 0 and q.is_active and b.is_active and q.answer_type = 'scale_0_4'),
      'company_info_questions', (select count(*) from public.questions q join public.diagnostic_blocks b on b.id = q.block_id where q.version_id = v.id and b.key = 'company_info'),
      'open_questions', (select count(*) from public.questions q join public.diagnostic_blocks b on b.id = q.block_id where q.version_id = v.id and b.key = 'open_questions'),
      'scoring_policies', (select count(*) from public.scoring_policies p where p.version_id = v.id),
      'maturity_levels', (select count(*) from public.maturity_levels m where m.version_id = v.id)
    ),
    'translation_integrity', jsonb_build_object(
      'required_locale', 'ru',
      'missing_version', (select count(*) where not exists (select 1 from public.diagnostic_version_translations t where t.version_id = v.id and t.locale = 'ru' and nullif(btrim(t.title), '') is not null)),
      'missing_blocks', (select count(*) from public.diagnostic_blocks b where b.version_id = v.id and not exists (select 1 from public.diagnostic_block_translations t where t.block_id = b.id and t.locale = 'ru' and nullif(btrim(t.title), '') is not null)),
      'missing_questions', (select count(*) from public.questions q where q.version_id = v.id and not exists (select 1 from public.question_translations t where t.question_id = q.id and t.locale = 'ru' and nullif(btrim(t.prompt), '') is not null)),
      'missing_options', (select count(*) from public.question_options o join public.questions q on q.id = o.question_id where q.version_id = v.id and not exists (select 1 from public.question_option_translations t where t.option_id = o.id and t.locale = 'ru' and nullif(btrim(t.label), '') is not null)),
      'missing_maturity', (select count(*) from public.maturity_levels m where m.version_id = v.id and not exists (select 1 from public.maturity_level_translations t where t.maturity_level_id = m.id and t.locale = 'ru' and nullif(btrim(t.label), '') is not null))
    ),
    'structure_question_3', (select t.prompt from public.questions q join public.diagnostic_blocks b on b.id = q.block_id join public.question_translations t on t.question_id = q.id where q.version_id = v.id and b.key = 'structure' and q.position = 3 and t.locale = 'ru'),
    'canonical', jsonb_build_object(
      'definition', v.definition,
      'version', to_jsonb(v) - 'id' - 'definition_id' - 'content_hash' - 'source_file' - 'published_at' - 'definition_key' - 'definition',
      'translations', coalesce((select jsonb_agg(to_jsonb(t) - 'version_id' order by t.locale) from public.diagnostic_version_translations t where t.version_id = v.id), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg((to_jsonb(b) - 'id' - 'version_id') || jsonb_build_object(
        'translations', coalesce((select jsonb_agg(to_jsonb(t) - 'block_id' order by t.locale) from public.diagnostic_block_translations t where t.block_id = b.id), '[]'::jsonb)
      ) order by b.key) from public.diagnostic_blocks b where b.version_id = v.id), '[]'::jsonb),
      'questions', coalesce((select jsonb_agg((to_jsonb(q) - 'id' - 'version_id' - 'block_id') || jsonb_build_object(
        'block_key', b.key,
        'translations', coalesce((select jsonb_agg(to_jsonb(t) - 'question_id' order by t.locale) from public.question_translations t where t.question_id = q.id), '[]'::jsonb),
        'options', coalesce((select jsonb_agg((to_jsonb(o) - 'id' - 'question_id') || jsonb_build_object(
          'translations', coalesce((select jsonb_agg(to_jsonb(t) - 'option_id' order by t.locale) from public.question_option_translations t where t.option_id = o.id), '[]'::jsonb)
        ) order by o.key) from public.question_options o where o.question_id = q.id), '[]'::jsonb)
      ) order by q.key) from public.questions q join public.diagnostic_blocks b on b.id = q.block_id where q.version_id = v.id), '[]'::jsonb),
      'scoring_policies', coalesce((select jsonb_agg(to_jsonb(p) - 'id' - 'version_id' - 'policy_hash' order by p.engine_key, p.engine_version, p.schema_version) from public.scoring_policies p where p.version_id = v.id), '[]'::jsonb),
      'maturity_levels', coalesce((select jsonb_agg((to_jsonb(m) - 'id' - 'version_id') || jsonb_build_object(
        'translations', coalesce((select jsonb_agg(to_jsonb(t) - 'maturity_level_id' order by t.locale) from public.maturity_level_translations t where t.maturity_level_id = m.id), '[]'::jsonb)
      ) order by m.key) from public.maturity_levels m where m.version_id = v.id), '[]'::jsonb)
    )
  ) as audit from versions v
)
select jsonb_build_object(
  'audit_schema_version', 1,
  'versions', coalesce((select jsonb_agg(audit order by version_number) from version_audits), '[]'::jsonb),
  'version3', jsonb_build_object(
    'metadata', (select audit - 'canonical' from version_audits where version_number = 3),
    'table_counts', coalesce((select jsonb_agg(jsonb_build_object('schema', relation_schema, 'table', relation_name, 'count', row_count) order by relation_schema, relation_name) from table_counts), '[]'::jsonb),
    'fk_paths', coalesce((select jsonb_agg(jsonb_build_object('schema', relation_schema, 'table', relation_name, 'constraints', constraints, 'count', row_count) order by relation_schema, relation_name, constraints) from path_counts where depth > 0), '[]'::jsonb),
    'foreign_key_coverage', coalesce((select jsonb_agg(jsonb_build_object('constraint', fk.conname, 'child', format('%I.%I', fk.child_schema, fk.child_table), 'parent', format('%I.%I', fk.parent_schema, fk.parent_table)) order by fk.child_schema, fk.child_table, fk.conname) from foreign_keys fk where fk.confrelid in (select relation_oid from paths)), '[]'::jsonb)
  )
) as methodology_audit;

commit;
