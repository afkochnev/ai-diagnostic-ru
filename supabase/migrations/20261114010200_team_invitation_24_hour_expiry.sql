-- Set the lifetime at token issuance, including links copied without an email.
begin;

create function private.set_ordinary_team_invitation_expiry() returns trigger
language plpgsql set search_path='' as $$
begin
  if not coalesce(private.team_product_participant(new.participant_id),false) then
    return new;
  end if;
  if tg_op='UPDATE' then
    if new.token_hash is not distinct from old.token_hash then
      raise exception 'team_invalid_input';
    end if;
  end if;
  new.expires_at:=least(new.expires_at,clock_timestamp()+interval '24 hours');
  return new;
end $$;

create trigger team_invitation_set_expiry
before insert or update of token_hash on private.team_invitations
for each row execute function private.set_ordinary_team_invitation_expiry();

revoke all on function private.set_ordinary_team_invitation_expiry() from public,anon,authenticated,service_role;

commit;
