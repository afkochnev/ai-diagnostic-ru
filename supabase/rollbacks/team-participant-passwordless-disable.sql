-- Non-destructive disable for the new passwordless entry helper only.
-- Deploy the previous staging web version and restore both saved email templates.
-- Keep identities, consent records, team responses, jobs and reports for audit.
begin;
revoke execute on function public.resolve_team_invitation_auth(text) from service_role;
commit;
