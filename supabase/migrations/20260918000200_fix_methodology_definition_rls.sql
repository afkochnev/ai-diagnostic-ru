-- Allow authenticated users to resolve definitions with published methodology.
-- The SECURITY DEFINER helper avoids evaluating the nested version lookup under
-- the diagnostic_definitions policy itself.
create or replace function private.can_read_diagnostic_definition(p_definition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.diagnostic_versions v
    where v.definition_id = p_definition_id
      and v.status = 'published'
  ) or exists (
    select 1
    from public.diagnostic_versions v
    join public.diagnostics d on d.version_id = v.id
    where v.definition_id = p_definition_id
      and d.created_by_user_id = (select auth.uid())
  );
$$;

revoke all on function private.can_read_diagnostic_definition(uuid) from public, anon;
grant execute on function private.can_read_diagnostic_definition(uuid) to authenticated;

drop policy methodology_definitions_read on public.diagnostic_definitions;
create policy methodology_definitions_read
  on public.diagnostic_definitions
  for select
  to authenticated
  using (
    private.can_read_diagnostic_definition(id)
  );
