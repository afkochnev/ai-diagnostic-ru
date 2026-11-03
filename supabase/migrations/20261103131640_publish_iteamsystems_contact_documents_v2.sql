-- Contact-only revisions requested by the owner on 2026-11-03.
-- Keep published v1 bodies, past consents, checkout terms and payments intact.
-- Deploy the WEB code accepting v1/v2 before switching the active pointers.
begin;
set local lock_timeout='5s';
lock table public.consent_documents in access exclusive mode;
do $publication$
declare
 source record;
 original_body text;
 revised_body text;
 source_kind text;
 source_policy text;
 target_policy text;
 commercial_title text;
 active_offer text;
begin
 select active_version into active_offer from private.commercial_legal_configuration where singleton for update;
 if active_offer is null or active_offer not in ('advanced-terms-ru-v1','advanced-terms-ru-v2') then
  raise exception 'unexpected_current_commercial_version';
 end if;
 if (select count(*) from public.consent_documents)<>2
 or not exists(select 1 from public.consent_documents where kind='data_processing' and not is_temporary and version in ('data-processing-consent-ru-v1','data-processing-consent-ru-v2'))
 or not exists(select 1 from public.consent_documents where kind='marketing' and not is_temporary and version in ('marketing-consent-ru-v1','marketing-consent-ru-v2')) then
  raise exception 'unexpected_current_consent_versions';
 end if;
 for source in select * from (values
  ('advanced-terms-ru-v1','advanced-terms-ru-v2','commercial','5e98f8712abd03413598efced5f1e1445701af873e552e32d9797c495191fe94','f660a98f802ae091cd3cb124a399002f16cb4eebd08b57ca329aed0115f65b94'),
  ('data-processing-policy-ru-v1','data-processing-policy-ru-v2','policy','d1e56ca672f3444333e51a3edc1397ceb62d89932f1c0f7620566aaa29b14de6','97a267d0f7110dbd3c43cf7dbd5c783a43d7e36ed7b7e7802bb99b7806ff5f13'),
  ('data-processing-consent-ru-v1','data-processing-consent-ru-v2','data_processing','45dbeac12254747f406bcc7915512a71afc504687c592a96d22726305f4ecc94','3a7a73d92488479fc125366b8598fe4da198fdd1b097260024da9f1a6902fed0'),
  ('marketing-consent-ru-v1','marketing-consent-ru-v2','marketing','f8767fad986137079748f00cafaca1e74d95ccf648546c8dd4d6e5b019e67dae','fad891d4c3e7e77177c5b20aa0f8ea5b642df265b846ead850c0b0c19f148247')
 ) as revisions(old_version,new_version,kind,old_sha256,new_sha256)
 loop
  if source.kind='commercial' then
   select body,title into original_body,commercial_title from public.commercial_legal_documents
    where version=source.old_version and content_sha256=source.old_sha256;
  else
   select body,kind,policy_version into original_body,source_kind,source_policy from public.privacy_legal_documents
    where version=source.old_version and body_sha256=source.old_sha256;
   if source_kind is distinct from source.kind or source_policy is distinct from
     (case when source.kind='policy' then null else 'data-processing-policy-ru-v1' end) then
    raise exception 'privacy_source_context_mismatch';
   end if;
  end if;
  if original_body is null or encode(sha256(convert_to(original_body,'UTF8')),'hex')<>source.old_sha256 then
   raise exception 'contact_revision_source_mismatch';
  end if;
  revised_body:=replace(replace(replace(original_body,'info@iteam.ru','alexander@iteamsystems.com'),
   'https://iteam.ru','https://audit.iteamsystems.com'),'22 октября 2026 года','3 ноября 2026 года');
  revised_body:=replace(replace(replace(replace(revised_body,
   'advanced-terms-ru-v1','advanced-terms-ru-v2'),
   'data-processing-policy-ru-v1','data-processing-policy-ru-v2'),
   'data-processing-consent-ru-v1','data-processing-consent-ru-v2'),
   'marketing-consent-ru-v1','marketing-consent-ru-v2');
  if encode(sha256(convert_to(revised_body,'UTF8')),'hex')<>source.new_sha256 then
   raise exception 'contact_revision_text_mismatch';
  end if;
  if source.kind='commercial' then
   insert into public.commercial_legal_documents(version,title,body,approved_at)
    values(source.new_version,commercial_title,revised_body,clock_timestamp()) on conflict(version) do nothing;
   if not exists(select 1 from public.commercial_legal_documents where version=source.new_version
    and content_sha256=source.new_sha256 and body=revised_body and title=commercial_title) then
    raise exception 'commercial_contact_version_conflict';
   end if;
  else
   target_policy:=case when source.kind='policy' then null else 'data-processing-policy-ru-v2' end;
   insert into public.privacy_legal_documents(version,kind,body,body_sha256,policy_version,approved_at,published_at)
    values(source.new_version,source.kind,revised_body,source.new_sha256,target_policy,clock_timestamp(),clock_timestamp())
    on conflict(version) do nothing;
   if not exists(select 1 from public.privacy_legal_documents where version=source.new_version
    and kind=source.kind and body_sha256=source.new_sha256 and body=revised_body
    and policy_version is not distinct from target_policy) then
    raise exception 'privacy_contact_version_conflict';
   end if;
  end if;
 end loop;
 update private.commercial_legal_configuration set active_version='advanced-terms-ru-v2' where singleton;
 update public.consent_documents set version='data-processing-consent-ru-v2' where kind='data_processing';
 update public.consent_documents set version='marketing-consent-ru-v2' where kind='marketing';
end $publication$;
commit;
