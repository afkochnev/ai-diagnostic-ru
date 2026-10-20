-- Invitation-scoped passwordless entry. No existing table, RLS policy or answer RPC changes.
begin;
create function public.resolve_team_invitation_auth(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.team_participants; inv private.team_invitations;
begin
  if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'team_invitation_unavailable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'team_invitation_unavailable'; end if;
  select * into inv from private.team_invitations where token_hash=p_token_hash;
  select * into p from public.team_participants where id=inv.participant_id;
  if p.id is null or p.revoked_at is not null or inv.expires_at<=now()
     or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id
       join public.accounts a on a.id=c.account_id where d.id=p.team_diagnostic_id and d.status='open' and a.status='active')
  then raise exception 'team_invitation_unavailable'; end if;
  return jsonb_build_object('email',p.email,'display_name',p.display_name,
    'create_user',not exists(select 1 from auth.users u where lower(u.email)=p.email));
end; $$;
revoke all on function public.resolve_team_invitation_auth(text) from public,anon,authenticated;
grant execute on function public.resolve_team_invitation_auth(text) to service_role;
commit;
