-- Ordinary invitation email access; global Auth OTP and recovery stay unchanged.
begin;
alter table private.team_invitations add column auth_claimed_at timestamptz;
create function private.reset_team_invitation_auth_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if new.token_hash is distinct from old.token_hash then new.auth_claimed_at:=null;end if;
 return new;
end $$;
create trigger team_invitation_auth_claim_reset before update of token_hash on private.team_invitations
 for each row execute function private.reset_team_invitation_auth_claim();
revoke all on function private.reset_team_invitation_auth_claim() from public,anon,authenticated,service_role;

-- Both operations lock the same existing invitation. A claim reserves 120s;
-- only the existing authenticated acceptance transaction consumes redeemed_at.
create function public.team_invitation_day_access(p_operation text,p_invitation_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv private.team_invitations; target jsonb; target_team uuid; team_status text; participant public.team_participants; at_time timestamptz; limited jsonb;
begin
 perform private.billing_service_actor();
 if p_operation not in('issue','claim') or p_operation is null or p_invitation_hash is null or p_invitation_hash!~'^[a-f0-9]{64}$' then raise exception 'team_invitation_unavailable';end if;
 select p.team_diagnostic_id into target_team from public.team_participants p join private.team_invitations i on i.participant_id=p.id where i.token_hash=p_invitation_hash;
 if target_team is null or exists(select 1 from private.controlled_team_runs where team_id=target_team) then raise exception 'team_invitation_unavailable';end if;
 select status into team_status from public.team_diagnostics where id=target_team for update;
 select * into participant from public.team_participants where id=(select participant_id from private.team_invitations where token_hash=p_invitation_hash) for update;
 -- Use the current locked rows after any close/revoke/renew wait, not a stable
 -- resolver snapshot captured before that concurrent transaction committed.
 if team_status is distinct from 'open' or participant.id is null or participant.revoked_at is not null
 or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id where d.id=target_team and a.status='active') then raise exception 'team_invitation_unavailable';end if;
 select * into inv from private.team_invitations where token_hash=p_invitation_hash for update;
 if inv.participant_id is null then raise exception 'team_invitation_unavailable';end if;
 target:=public.resolve_team_invitation_auth(p_invitation_hash);
 if target->>'email' is distinct from participant.email then raise exception 'team_invitation_unavailable';end if;
 at_time:=clock_timestamp();
 if inv.expires_at<=at_time then raise exception 'team_invitation_unavailable';end if;
 if inv.redeemed_at is not null then return jsonb_build_object('status','spent');end if;
 if p_operation='issue' then
  update private.team_invitations set expires_at=least(expires_at,at_time+interval '24 hours') where participant_id=inv.participant_id returning * into inv;
  return jsonb_build_object('status','issued','email',target->>'email','expires_at',inv.expires_at);
 end if;
 if inv.auth_claimed_at is not null and inv.auth_claimed_at+interval '120 seconds'>at_time then
  return jsonb_build_object('status','busy','retry_after',ceil(extract(epoch from inv.auth_claimed_at+interval '120 seconds'-at_time))::integer);
 end if;
 limited:=public.consume_rate_limit('team-day-claim:'||p_invitation_hash,5,3600);
 if coalesce((limited->>'allowed')::boolean,false) is not true then return jsonb_build_object('status','rate_limited','retry_after',limited->'retry_after');end if;
 update private.team_invitations set auth_claimed_at=at_time where participant_id=inv.participant_id;
 return target||jsonb_build_object('status','claimed','lease_until',at_time+interval '120 seconds','expires_at',inv.expires_at);
end $$;
revoke all on function public.team_invitation_day_access(text,text) from public,anon,authenticated,service_role;
grant execute on function public.team_invitation_day_access(text,text) to service_role;
commit;
