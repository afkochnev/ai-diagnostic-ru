create or replace function private.guard_diagnostic_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.company_id <> old.company_id or new.created_by_user_id <> old.created_by_user_id or new.version_id <> old.version_id or new.started_at <> old.started_at then raise exception 'diagnostic immutable fields cannot be changed'; end if;
  if old.status='submitted' and new.status not in ('submitted','scoring') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  if old.status='scoring' and new.status not in ('scoring','completed','scoring_failed') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  if old.status='completed' and new.status <> old.status then raise exception 'completed diagnostic lifecycle is immutable'; end if;
  if old.status='scoring_failed' and new.status not in ('scoring_failed','scoring') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  new.last_saved_at := now(); return new;
end; $$;
