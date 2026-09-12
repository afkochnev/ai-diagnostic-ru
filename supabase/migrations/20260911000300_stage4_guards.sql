create or replace function private.reject_published_version_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'published' then raise exception 'published methodology is immutable'; end if;
  return coalesce(new, old);
end;
$$;
create trigger diagnostic_versions_immutable before update or delete on public.diagnostic_versions for each row execute function private.reject_published_version_change();

grant delete on public.answers to authenticated;
create policy answers_owner_delete on public.answers for delete to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid()) and d.status='in_progress'));
