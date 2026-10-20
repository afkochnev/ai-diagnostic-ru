-- Non-destructive feature rollback, AFTER restoring the previous web image.
-- Retain pending Auth reservations and their verified-session guard. Do not
-- restore the old predicate or fabricate consent for pending identities.
begin;
revoke execute on function public.reserve_team_invitation_identity(text,text) from service_role;
revoke execute on function public.finalize_team_invitation_identity(text,boolean,text,text) from authenticated;
commit;
