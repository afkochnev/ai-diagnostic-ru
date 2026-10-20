-- Prepared operational rollback only. NOT a forward migration; NOT executed.
-- Disable only new team API grants, preserving every response and legacy object.
begin;
revoke all on function public.create_team_diagnostic(uuid,text),
 public.invite_team_participant(uuid,text,text,text),
 public.renew_team_invitation(uuid,text),public.revoke_team_participant(uuid),
 public.accept_team_invitation(text),public.read_team_response(uuid),
 public.save_team_response(uuid,integer,jsonb,boolean) from authenticated;
revoke all on public.team_diagnostics,public.team_participants from authenticated;
commit;
