drop policy if exists lead_requests_owner_create on public.lead_requests;
create policy lead_requests_owner_create on public.lead_requests for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'new'
  and exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.company_id=company_id and d.created_by_user_id=(select auth.uid()) and d.status='completed')
  and exists (select 1 from public.ai_reports r where r.id=report_id and r.diagnostic_id=diagnostic_id and r.status='completed')
);
