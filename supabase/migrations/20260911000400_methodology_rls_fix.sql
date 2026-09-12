create or replace function private.can_read_diagnostic_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.diagnostics d where d.version_id = p_version_id and d.created_by_user_id = (select auth.uid()));
$$;
revoke all on function private.can_read_diagnostic_version(uuid) from public, anon;
grant execute on function private.can_read_diagnostic_version(uuid) to authenticated;

drop policy methodology_definitions_read on public.diagnostic_definitions;
create policy methodology_definitions_read on public.diagnostic_definitions for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.definition_id=id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_versions_read on public.diagnostic_versions;
create policy methodology_versions_read on public.diagnostic_versions for select to authenticated using (status='published' or private.can_read_diagnostic_version(id));
drop policy methodology_version_translations_read on public.diagnostic_version_translations;
create policy methodology_version_translations_read on public.diagnostic_version_translations for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_blocks_read on public.diagnostic_blocks;
create policy methodology_blocks_read on public.diagnostic_blocks for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_block_translations_read on public.diagnostic_block_translations;
create policy methodology_block_translations_read on public.diagnostic_block_translations for select to authenticated using (exists (select 1 from public.diagnostic_blocks b join public.diagnostic_versions v on v.id=b.version_id where b.id=block_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_questions_read on public.questions;
create policy methodology_questions_read on public.questions for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_question_translations_read on public.question_translations;
create policy methodology_question_translations_read on public.question_translations for select to authenticated using (exists (select 1 from public.questions q join public.diagnostic_versions v on v.id=q.version_id where q.id=question_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_options_read on public.question_options;
create policy methodology_options_read on public.question_options for select to authenticated using (exists (select 1 from public.questions q join public.diagnostic_versions v on v.id=q.version_id where q.id=question_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_option_translations_read on public.question_option_translations;
create policy methodology_option_translations_read on public.question_option_translations for select to authenticated using (exists (select 1 from public.question_options o join public.questions q on q.id=o.question_id join public.diagnostic_versions v on v.id=q.version_id where o.id=option_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_scoring_read on public.scoring_policies;
create policy methodology_scoring_read on public.scoring_policies for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_maturity_read on public.maturity_levels;
create policy methodology_maturity_read on public.maturity_levels for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
drop policy methodology_maturity_translations_read on public.maturity_level_translations;
create policy methodology_maturity_translations_read on public.maturity_level_translations for select to authenticated using (exists (select 1 from public.maturity_levels m join public.diagnostic_versions v on v.id=m.version_id where m.id=maturity_level_id and (v.status='published' or private.can_read_diagnostic_version(v.id))));
