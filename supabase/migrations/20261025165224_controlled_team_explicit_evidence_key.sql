-- Explicit, context-derived evidence material. Supabase credentials authorize
-- the request only; Authorization/apikey are never used as HMAC key material.
-- No window, reservation, budget, gate, historical row or credential is changed.
begin;
do $$begin
 if encode(sha256(convert_to((select prosrc from pg_proc where oid='private.controlled_team_auth_mac(text)'::regprocedure),'UTF8')),'hex') is distinct from '4cc85f03839dc6456fe2f58e5ad14b41bbf2057968c1a6335ca59684fdbb72b0' then raise exception 'controlled_team_evidence_definition_drift';end if;
 if encode(sha256(convert_to((select prosrc from pg_proc where oid='private.controlled_team_preservation_hmac(text,jsonb)'::regprocedure),'UTF8')),'hex') is distinct from '2856904f1b3458082917dfc39fe8dc6c4e21c81fcb4a14a61823e3af6acf364d' then raise exception 'controlled_team_evidence_definition_drift';end if;
 if encode(sha256(convert_to((select prosrc from pg_proc where oid='public.check_controlled_team_auth_evidence_key(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),'UTF8')),'hex') is distinct from 'f53b6003e91252f9405737a3209e58e34659759843227f877b9006a6b3bb74a5' then raise exception 'controlled_team_evidence_definition_drift';end if;
 if encode(sha256(convert_to((select prosrc from pg_proc where oid='public.capture_controlled_team_w2_preservation()'::regprocedure),'UTF8')),'hex') is distinct from 'd26ff08a31b1e6375fb856ce213a9aa16caa3f327950a0e107c255722e0bcfcb' then raise exception 'controlled_team_evidence_definition_drift';end if;
end $$;

create function private.controlled_team_evidence_mac(p_message text) returns text
language plpgsql stable security definer set search_path='' as $$declare headers jsonb;header text;begin
 perform private.controlled_team_service();
 begin headers:=current_setting('request.headers',true)::jsonb;exception when others then return null;end;
 if jsonb_typeof(headers) is distinct from 'object' or jsonb_typeof(headers->'x-aca-w2-evidence-key') is distinct from 'string' then return null;end if;
 header:=headers->>'x-aca-w2-evidence-key';
 if octet_length(header)<>74 or header !~ '^aca-w2-v1[.][a-f0-9]{64}$' then return null;end if;
 return encode(extensions.hmac(convert_to(p_message,'UTF8'),decode(substring(header from 11),'hex'),'sha256'),'hex');
end $$;
revoke all on function private.controlled_team_evidence_mac(text) from public,anon,authenticated,service_role;
create or replace function private.controlled_team_auth_mac(p_message text) returns text
language plpgsql stable security definer set search_path='' as $$begin
 return private.controlled_team_evidence_mac(p_message);
end $$;
create or replace function private.controlled_team_preservation_hmac(p_domain text,p_value jsonb) returns text
language plpgsql stable security definer set search_path='' as $$declare result text;begin
 result:=private.controlled_team_evidence_mac(E'aca-w2-preservation-v1\n'||p_domain||E'\n'||coalesce(p_value,'null'::jsonb)::text);
 if result is null then raise exception 'controlled_team_capture_denied';end if;return result;
 exception when others then raise exception 'controlled_team_capture_denied';end $$;
revoke all on function private.controlled_team_auth_mac(text),private.controlled_team_preservation_hmac(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.check_controlled_team_auth_evidence_key(p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,p_operation text,p_reservation_id uuid,p_challenge text,p_challenge_mac text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare plan text;expected text;unconfigured boolean;begin
 perform private.controlled_team_service();
 select (select count(*)=1 and bool_and(singleton and run_id is null) from private.controlled_team_policy)
 and not exists(select 1 from private.controlled_team_runs)
 and not exists(select 1 from private.controlled_team_windows)
 and not exists(select 1 from private.controlled_team_effects)
 and not exists(select 1 from private.controlled_team_verifications)
 and not exists(select 1 from private.controlled_team_auth_wire)
 and (select count(*)=1 and bool_and(not team_creation_enabled and not team_invitations_enabled) from private.launch_controls)
 and (select count(*)=1 and bool_and(not mock_enabled and not yookassa_enabled and not yookassa_reconciliation_enabled and not yookassa_live_approved) from private.billing_configuration) into unconfigured;
 if p_operation='capability' and coalesce(unconfigured,false) then
  -- Read-only transport proof only. This never admits issuance/verification or
  -- creates a run/cohort/window on an unconfigured installation.
  if p_run_id is distinct from 'e3623f1d-2da0-4dfe-b600-d747f529c5fc'::uuid
   or p_participant_id is distinct from '0ae17418-e97a-46c7-9000-c13580f72506'::uuid
   or p_user_id is distinct from 'b7cc06c7-056c-4fd8-b445-eeaf187cec7c'::uuid
   or p_window_id is not null or p_reservation_id is not null
   then raise exception 'controlled_team_auth_scope_denied';end if;
 else plan:=private.controlled_team_auth_scope(p_run_id,p_window_id,p_participant_id,p_user_id,p_operation,p_reservation_id);end if;
 if p_challenge ~ '^[a-f0-9]{64}$' and p_challenge_mac ~ '^[a-f0-9]{64}$' then expected:=private.controlled_team_auth_mac(E'aca-w2-auth-evidence-v1\nchallenge\n'||p_run_id::text||E'\n'||coalesce(p_window_id::text,'-')||E'\n'||p_participant_id::text||E'\n'||p_user_id::text||E'\n'||p_operation||E'\n'||coalesce(p_reservation_id::text,'-')||E'\n'||p_challenge);end if;
 return jsonb_build_object('matched',coalesce(expected=p_challenge_mac,false),'run_id',p_run_id,'window_id',p_window_id,'participant_id',p_participant_id,'user_id',p_user_id,'operation',p_operation,'reservation_id',p_reservation_id,'server_now',clock_timestamp(),'approved_plan_hash',plan);
end $$;

create function public.capture_controlled_team_w2_preservation(p_run_id uuid,p_plan_sha256 text,p_application_sha text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare evidence jsonb;unconfigured boolean;begin
 perform private.controlled_team_service();
 if p_run_id is distinct from 'e3623f1d-2da0-4dfe-b600-d747f529c5fc'::uuid
 or p_plan_sha256 is null or p_plan_sha256 !~ '^[a-f0-9]{64}$' or octet_length(p_plan_sha256)<>64
 or p_application_sha is null or p_application_sha !~ '^[a-f0-9]{40}$' or octet_length(p_application_sha)<>40
 then raise exception 'controlled_team_capture_denied';end if;
 select (select count(*)=1 and bool_and(singleton and run_id is null) from private.controlled_team_policy)
 and not exists(select 1 from private.controlled_team_runs)
 and not exists(select 1 from private.controlled_team_windows)
 and not exists(select 1 from private.controlled_team_effects)
 and not exists(select 1 from private.controlled_team_verifications)
 and not exists(select 1 from private.controlled_team_auth_wire)
 and (select count(*)=1 and bool_and(not team_creation_enabled and not team_invitations_enabled) from private.launch_controls)
 and (select count(*)=1 and bool_and(not mock_enabled and not yookassa_enabled and not yookassa_reconciliation_enabled and not yookassa_live_approved) from private.billing_configuration) into unconfigured;
 if current_setting('transaction_read_only')<>'on' or current_setting('TimeZone') not in('UTC','Etc/UTC')
 or not(coalesce(unconfigured,false) or exists(select 1 from private.controlled_team_policy p join private.controlled_team_runs r on r.id=p.run_id where p.singleton and r.id=p_run_id and r.status='stopped'))
 then raise exception 'controlled_team_capture_denied';end if;
 with raw as materialized (
select 'auth.audit_log_entries' name,to_jsonb(r) j from auth.audit_log_entries r
union all
select 'auth.custom_oauth_providers' name,to_jsonb(r) j from auth.custom_oauth_providers r
union all
select 'auth.flow_state' name,to_jsonb(r) j from auth.flow_state r
union all
select 'auth.identities' name,to_jsonb(r) j from auth.identities r
union all
select 'auth.instances' name,to_jsonb(r) j from auth.instances r
union all
select 'auth.mfa_amr_claims' name,to_jsonb(r) j from auth.mfa_amr_claims r
union all
select 'auth.mfa_challenges' name,to_jsonb(r) j from auth.mfa_challenges r
union all
select 'auth.mfa_factors' name,to_jsonb(r) j from auth.mfa_factors r
union all
select 'auth.mfa_recovery_code_sets' name,to_jsonb(r) j from auth.mfa_recovery_code_sets r
union all
select 'auth.mfa_recovery_codes' name,to_jsonb(r) j from auth.mfa_recovery_codes r
union all
select 'auth.oauth_authorizations' name,to_jsonb(r) j from auth.oauth_authorizations r
union all
select 'auth.oauth_client_states' name,to_jsonb(r) j from auth.oauth_client_states r
union all
select 'auth.oauth_clients' name,to_jsonb(r) j from auth.oauth_clients r
union all
select 'auth.oauth_consents' name,to_jsonb(r) j from auth.oauth_consents r
union all
select 'auth.one_time_tokens' name,to_jsonb(r) j from auth.one_time_tokens r
union all
select 'auth.refresh_tokens' name,to_jsonb(r) j from auth.refresh_tokens r
union all
select 'auth.saml_providers' name,to_jsonb(r) j from auth.saml_providers r
union all
select 'auth.saml_relay_states' name,to_jsonb(r) j from auth.saml_relay_states r
union all
select 'auth.schema_migrations' name,to_jsonb(r) j from auth.schema_migrations r
union all
select 'auth.scim_tokens' name,to_jsonb(r) j from auth.scim_tokens r
union all
select 'auth.scim_users' name,to_jsonb(r) j from auth.scim_users r
union all
select 'auth.sessions' name,to_jsonb(r) j from auth.sessions r
union all
select 'auth.sso_domains' name,to_jsonb(r) j from auth.sso_domains r
union all
select 'auth.sso_providers' name,to_jsonb(r) j from auth.sso_providers r
union all
select 'auth.users' name,to_jsonb(r) j from auth.users r
union all
select 'auth.webauthn_challenges' name,to_jsonb(r) j from auth.webauthn_challenges r
union all
select 'auth.webauthn_credentials' name,to_jsonb(r) j from auth.webauthn_credentials r
union all
select 'private.account_subscriptions' name,to_jsonb(r) j from private.account_subscriptions r
union all
select 'private.acquisition_visits' name,to_jsonb(r) j from private.acquisition_visits r
union all
select 'private.admin_plan_changes' name,to_jsonb(r) j from private.admin_plan_changes r
union all
select 'private.advanced_conversion_intents' name,to_jsonb(r) j from private.advanced_conversion_intents r
union all
select 'private.anonymous_diagnostic_consents' name,to_jsonb(r) j from private.anonymous_diagnostic_consents r
union all
select 'private.anonymous_diagnostic_mutations' name,to_jsonb(r) j from private.anonymous_diagnostic_mutations r
union all
select 'private.anonymous_diagnostic_sessions' name,to_jsonb(r) j from private.anonymous_diagnostic_sessions r
union all
select 'private.audit_events' name,to_jsonb(r) j from private.audit_events r
union all
select 'private.billing_checkout_sessions' name,to_jsonb(r) j from private.billing_checkout_sessions r
union all
select 'private.billing_checkout_terms' name,to_jsonb(r) j from private.billing_checkout_terms r
union all
select 'private.billing_configuration' name,to_jsonb(r) j from private.billing_configuration r
union all
select 'private.billing_event_attempts' name,to_jsonb(r) j from private.billing_event_attempts r
union all
select 'private.billing_events' name,to_jsonb(r) j from private.billing_events r
union all
select 'private.billing_offers' name,to_jsonb(r) j from private.billing_offers r
union all
select 'private.billing_payments' name,to_jsonb(r) j from private.billing_payments r
union all
select 'private.billing_plan_audit' name,to_jsonb(r) j from private.billing_plan_audit r
union all
select 'private.billing_provider_subscriptions' name,to_jsonb(r) j from private.billing_provider_subscriptions r
union all
select 'private.billing_refunds' name,to_jsonb(r) j from private.billing_refunds r
union all
select 'private.commercial_legal_configuration' name,to_jsonb(r) j from private.commercial_legal_configuration r
union all
select 'private.controlled_team_auth_wire' name,to_jsonb(r) j from private.controlled_team_auth_wire r
union all
select 'private.controlled_team_effects' name,to_jsonb(r) j from private.controlled_team_effects r
union all
select 'private.controlled_team_policy' name,to_jsonb(r) j from private.controlled_team_policy r
union all
select 'private.controlled_team_runs' name,to_jsonb(r) j from private.controlled_team_runs r
union all
select 'private.controlled_team_verifications' name,to_jsonb(r) j from private.controlled_team_verifications r
union all
select 'private.controlled_team_windows' name,to_jsonb(r) j from private.controlled_team_windows r
union all
select 'private.entitlement_definitions' name,to_jsonb(r) j from private.entitlement_definitions r
union all
select 'private.launch_controls' name,to_jsonb(r) j from private.launch_controls r
union all
select 'private.marketing_preferences' name,to_jsonb(r) j from private.marketing_preferences r
union all
select 'private.marketing_withdrawals' name,to_jsonb(r) j from private.marketing_withdrawals r
union all
select 'private.plan_entitlements' name,to_jsonb(r) j from private.plan_entitlements r
union all
select 'private.product_events' name,to_jsonb(r) j from private.product_events r
union all
select 'private.retention_holds' name,to_jsonb(r) j from private.retention_holds r
union all
select 'private.retention_runs' name,to_jsonb(r) j from private.retention_runs r
union all
select 'private.team_identity_reservations' name,to_jsonb(r) j from private.team_identity_reservations r
union all
select 'private.team_invitations' name,to_jsonb(r) j from private.team_invitations r
union all
select 'private.team_jobs' name,to_jsonb(r) j from private.team_jobs r
union all
select 'private.team_qualitative_syntheses' name,to_jsonb(r) j from private.team_qualitative_syntheses r
union all
select 'private.team_questionnaires' name,to_jsonb(r) j from private.team_questionnaires r
union all
select 'private.team_responses' name,to_jsonb(r) j from private.team_responses r
union all
select 'private.team_scoring_snapshots' name,to_jsonb(r) j from private.team_scoring_snapshots r
union all
select 'public.account_memberships' name,to_jsonb(r) j from public.account_memberships r
union all
select 'public.accounts' name,to_jsonb(r) j from public.accounts r
union all
select 'public.ai_reports' name,to_jsonb(r) j from public.ai_reports r
union all
select 'public.answers' name,to_jsonb(r) j from public.answers r
union all
select 'public.commercial_legal_documents' name,to_jsonb(r) j from public.commercial_legal_documents r
union all
select 'public.company_profiles' name,to_jsonb(r) j from public.company_profiles r
union all
select 'public.consent_documents' name,to_jsonb(r) j from public.consent_documents r
union all
select 'public.consultation_notification_deliveries' name,to_jsonb(r) j from public.consultation_notification_deliveries r
union all
select 'public.diagnostic_block_results' name,to_jsonb(r) j from public.diagnostic_block_results r
union all
select 'public.diagnostic_block_translations' name,to_jsonb(r) j from public.diagnostic_block_translations r
union all
select 'public.diagnostic_blocks' name,to_jsonb(r) j from public.diagnostic_blocks r
union all
select 'public.diagnostic_company_snapshots' name,to_jsonb(r) j from public.diagnostic_company_snapshots r
union all
select 'public.diagnostic_definitions' name,to_jsonb(r) j from public.diagnostic_definitions r
union all
select 'public.diagnostic_mutations' name,to_jsonb(r) j from public.diagnostic_mutations r
union all
select 'public.diagnostic_results' name,to_jsonb(r) j from public.diagnostic_results r
union all
select 'public.diagnostic_version_translations' name,to_jsonb(r) j from public.diagnostic_version_translations r
union all
select 'public.diagnostic_versions' name,to_jsonb(r) j from public.diagnostic_versions r
union all
select 'public.diagnostics' name,to_jsonb(r) j from public.diagnostics r
union all
select 'public.email_deliveries' name,to_jsonb(r) j from public.email_deliveries r
union all
select 'public.feedback' name,to_jsonb(r) j from public.feedback r
union all
select 'public.industries' name,to_jsonb(r) j from public.industries r
union all
select 'public.industry_translations' name,to_jsonb(r) j from public.industry_translations r
union all
select 'public.jobs' name,to_jsonb(r) j from public.jobs r
union all
select 'public.lead_requests' name,to_jsonb(r) j from public.lead_requests r
union all
select 'public.maturity_level_translations' name,to_jsonb(r) j from public.maturity_level_translations r
union all
select 'public.maturity_levels' name,to_jsonb(r) j from public.maturity_levels r
union all
select 'public.plans' name,to_jsonb(r) j from public.plans r
union all
select 'public.privacy_legal_documents' name,to_jsonb(r) j from public.privacy_legal_documents r
union all
select 'public.question_option_translations' name,to_jsonb(r) j from public.question_option_translations r
union all
select 'public.question_options' name,to_jsonb(r) j from public.question_options r
union all
select 'public.question_translations' name,to_jsonb(r) j from public.question_translations r
union all
select 'public.questions' name,to_jsonb(r) j from public.questions r
union all
select 'public.rate_limit_windows' name,to_jsonb(r) j from public.rate_limit_windows r
union all
select 'public.report_artifacts' name,to_jsonb(r) j from public.report_artifacts r
union all
select 'public.revenue_range_translations' name,to_jsonb(r) j from public.revenue_range_translations r
union all
select 'public.revenue_ranges' name,to_jsonb(r) j from public.revenue_ranges r
union all
select 'public.scoring_policies' name,to_jsonb(r) j from public.scoring_policies r
union all
select 'public.team_ai_reports' name,to_jsonb(r) j from public.team_ai_reports r
union all
select 'public.team_block_results' name,to_jsonb(r) j from public.team_block_results r
union all
select 'public.team_diagnostics' name,to_jsonb(r) j from public.team_diagnostics r
union all
select 'public.team_participants' name,to_jsonb(r) j from public.team_participants r
union all
select 'public.team_question_statistics' name,to_jsonb(r) j from public.team_question_statistics r
union all
select 'public.team_report_artifacts' name,to_jsonb(r) j from public.team_report_artifacts r
union all
select 'public.team_results' name,to_jsonb(r) j from public.team_results r
union all
select 'public.user_consents' name,to_jsonb(r) j from public.user_consents r
union all
select 'public.user_roles' name,to_jsonb(r) j from public.user_roles r
union all
select 'public.users' name,to_jsonb(r) j from public.users r
union all
select 'storage.buckets' name,to_jsonb(r) j from storage.buckets r
union all
select 'storage.objects' name,to_jsonb(r) j from storage.objects r), keyed as materialized(select name,j,coalesce((select jsonb_object_agg(a.attname,j->a.attname order by a.attname) from pg_constraint c cross join lateral unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.contype='p' and c.conrelid=name::regclass),j) pk from raw),
 rows as materialized(select name,private.controlled_team_preservation_hmac(E'key\n'||name,pk) key,
 jsonb_build_object('key',private.controlled_team_preservation_hmac(E'key\n'||name,pk),'full',private.controlled_team_preservation_hmac(E'row\n'||name||E'\n'||pk::text,j),
 'fields',(select jsonb_object_agg(k,private.controlled_team_preservation_hmac(E'cell\n'||name||E'\n'||pk::text||E'\n'||k,v) order by k) from jsonb_each(j) f(k,v)),
 'facts',private.controlled_team_preservation_facts(name,j)) value from keyed),
 captures as materialized(select unnest(ARRAY['auth.audit_log_entries','auth.custom_oauth_providers','auth.flow_state','auth.identities','auth.instances','auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors','auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients','auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens','auth.saml_providers','auth.saml_relay_states','auth.schema_migrations','auth.scim_tokens','auth.scim_users','auth.sessions','auth.sso_domains','auth.sso_providers','auth.users','auth.webauthn_challenges','auth.webauthn_credentials','private.account_subscriptions','private.acquisition_visits','private.admin_plan_changes','private.advanced_conversion_intents','private.anonymous_diagnostic_consents','private.anonymous_diagnostic_mutations','private.anonymous_diagnostic_sessions','private.audit_events','private.billing_checkout_sessions','private.billing_checkout_terms','private.billing_configuration','private.billing_event_attempts','private.billing_events','private.billing_offers','private.billing_payments','private.billing_plan_audit','private.billing_provider_subscriptions','private.billing_refunds','private.commercial_legal_configuration','private.controlled_team_auth_wire','private.controlled_team_effects','private.controlled_team_policy','private.controlled_team_runs','private.controlled_team_verifications','private.controlled_team_windows','private.entitlement_definitions','private.launch_controls','private.marketing_preferences','private.marketing_withdrawals','private.plan_entitlements','private.product_events','private.retention_holds','private.retention_runs','private.team_identity_reservations','private.team_invitations','private.team_jobs','private.team_qualitative_syntheses','private.team_questionnaires','private.team_responses','private.team_scoring_snapshots','public.account_memberships','public.accounts','public.ai_reports','public.answers','public.commercial_legal_documents','public.company_profiles','public.consent_documents','public.consultation_notification_deliveries','public.diagnostic_block_results','public.diagnostic_block_translations','public.diagnostic_blocks','public.diagnostic_company_snapshots','public.diagnostic_definitions','public.diagnostic_mutations','public.diagnostic_results','public.diagnostic_version_translations','public.diagnostic_versions','public.diagnostics','public.email_deliveries','public.feedback','public.industries','public.industry_translations','public.jobs','public.lead_requests','public.maturity_level_translations','public.maturity_levels','public.plans','public.privacy_legal_documents','public.question_option_translations','public.question_options','public.question_translations','public.questions','public.rate_limit_windows','public.report_artifacts','public.revenue_range_translations','public.revenue_ranges','public.scoring_policies','public.team_ai_reports','public.team_block_results','public.team_diagnostics','public.team_participants','public.team_question_statistics','public.team_report_artifacts','public.team_results','public.user_consents','public.user_roles','public.users','storage.buckets','storage.objects']::text[]) name)
 select jsonb_build_object('format','ACA_W2_PRESERVATION_HMAC_V2','algorithm','HMAC-SHA256','context',jsonb_build_object('domain','aca-w2-evidence-key','version',1,'rootRunId',p_run_id,'approvedPlanSHA256',p_plan_sha256,'canonicalAppSHA',p_application_sha),'project',case when unconfigured then null else 'fhvxqeaujjeiflanqsbg' end,'capturedAt',clock_timestamp(),'databaseClock',clock_timestamp(),'transactionReadOnly',current_setting('transaction_read_only'),'timezone','UTC',
 'tables',(select jsonb_object_agg(c.name,jsonb_build_object('columns',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.name::regclass and a.attnum>0 and not a.attisdropped),'rows',coalesce((select jsonb_agg(r.value order by r.key) from rows r where r.name=c.name),'[]'::jsonb)) order by c.name) from captures c),
 'catalogue',private.controlled_team_preservation_hmac('catalogue',jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and c.relkind in('r','p')),
 'namespaces',(select coalesce(jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl) order by nspname),'[]'::jsonb) from pg_namespace where nspname in('public','private','auth','storage','supabase_migrations')),
 'columnACLs',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attnum,a.attname,a.attacl,a.attisdropped) order by n.nspname,c.relname,a.attnum),'[]'::jsonb) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and a.attnum>0),
 'defaultACLs',(select coalesce(jsonb_agg(to_jsonb(d) order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb) from pg_default_acl d),
 'roleFlags',(select coalesce(jsonb_agg(to_jsonb(r) order by r.oid),'[]'::jsonb) from(select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig from pg_roles) r),
 'roleMemberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]'::jsonb) from pg_auth_members m),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relpersistence,case when c.relkind in('v','m') then pg_get_viewdef(c.oid,true) else null end) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and c.relkind in('r','p','v','m','S','f')),
 'sequences',(select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,sequencename),'[]'::jsonb) from (select schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname in('public','private','auth','storage','supabase_migrations')) x),
 'columns',(select coalesce(jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.ordinal_position),'[]'::jsonb) from information_schema.columns x where table_schema in('public','private','auth','storage','supabase_migrations')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname),'[]'::jsonb) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl,p.proconfig,p.proowner) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and p.prokind='f'),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]'::jsonb) from pg_policies p where schemaname in('public','private','auth','storage','supabase_migrations')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and not t.tgisinternal),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by schemaname,tablename,indexname),'[]'::jsonb) from pg_indexes i where schemaname in('public','private','auth','storage','supabase_migrations')))),
 'ledger',jsonb_build_object('count',(select count(*) from supabase_migrations.schema_migrations),'digest',private.controlled_team_preservation_hmac('ledger',(select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations m))),
 'gates',jsonb_build_object('launch',(select count(*) from private.launch_controls where anonymous_start_enabled or team_creation_enabled or team_invitations_enabled),'financial',(select count(*) from private.billing_configuration where mock_enabled or yookassa_enabled or yookassa_reconciliation_enabled or yookassa_live_approved)),
 'wireTraces',(select coalesce(jsonb_agg(to_jsonb(w)-'credential_mac' order by reserved_at,id),'[]'::jsonb) from private.controlled_team_auth_wire w where root_run_id='e3623f1d-2da0-4dfe-b600-d747f529c5fc'::uuid)) into evidence;
 if (select array_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage') and c.relkind in('r','p')) is distinct from ARRAY['auth.audit_log_entries','auth.custom_oauth_providers','auth.flow_state','auth.identities','auth.instances','auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors','auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients','auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens','auth.saml_providers','auth.saml_relay_states','auth.schema_migrations','auth.scim_tokens','auth.scim_users','auth.sessions','auth.sso_domains','auth.sso_providers','auth.users','auth.webauthn_challenges','auth.webauthn_credentials','private.account_subscriptions','private.acquisition_visits','private.admin_plan_changes','private.advanced_conversion_intents','private.anonymous_diagnostic_consents','private.anonymous_diagnostic_mutations','private.anonymous_diagnostic_sessions','private.audit_events','private.billing_checkout_sessions','private.billing_checkout_terms','private.billing_configuration','private.billing_event_attempts','private.billing_events','private.billing_offers','private.billing_payments','private.billing_plan_audit','private.billing_provider_subscriptions','private.billing_refunds','private.commercial_legal_configuration','private.controlled_team_auth_wire','private.controlled_team_effects','private.controlled_team_policy','private.controlled_team_runs','private.controlled_team_verifications','private.controlled_team_windows','private.entitlement_definitions','private.launch_controls','private.marketing_preferences','private.marketing_withdrawals','private.plan_entitlements','private.product_events','private.retention_holds','private.retention_runs','private.team_identity_reservations','private.team_invitations','private.team_jobs','private.team_qualitative_syntheses','private.team_questionnaires','private.team_responses','private.team_scoring_snapshots','public.account_memberships','public.accounts','public.ai_reports','public.answers','public.commercial_legal_documents','public.company_profiles','public.consent_documents','public.consultation_notification_deliveries','public.diagnostic_block_results','public.diagnostic_block_translations','public.diagnostic_blocks','public.diagnostic_company_snapshots','public.diagnostic_definitions','public.diagnostic_mutations','public.diagnostic_results','public.diagnostic_version_translations','public.diagnostic_versions','public.diagnostics','public.email_deliveries','public.feedback','public.industries','public.industry_translations','public.jobs','public.lead_requests','public.maturity_level_translations','public.maturity_levels','public.plans','public.privacy_legal_documents','public.question_option_translations','public.question_options','public.question_translations','public.questions','public.rate_limit_windows','public.report_artifacts','public.revenue_range_translations','public.revenue_ranges','public.scoring_policies','public.team_ai_reports','public.team_block_results','public.team_diagnostics','public.team_participants','public.team_question_statistics','public.team_report_artifacts','public.team_results','public.user_consents','public.user_roles','public.users','storage.buckets','storage.objects']::text[] then raise exception 'controlled_team_capture_denied';end if;
 return evidence;exception when others then raise exception 'controlled_team_capture_denied';end $$;

drop function public.capture_controlled_team_w2_preservation();
revoke all on function public.capture_controlled_team_w2_preservation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.capture_controlled_team_w2_preservation(uuid,text,text) to service_role;
-- Diagnostic APIs are removed from the accepted schema. Their immutable
-- historical migrations remain in source/history for auditability.
drop function public.check_controlled_team_auth_header_capability(uuid,uuid,uuid,uuid,text,uuid,text,text,text);
drop function public.inspect_controlled_team_auth_header_channels(uuid,uuid,uuid,uuid,text,uuid,text,text);
commit;
