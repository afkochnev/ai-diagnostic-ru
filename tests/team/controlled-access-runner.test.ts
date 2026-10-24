import { describe, it, expect, vi } from "vitest";
import { runControlledAccessOnce } from "@/server/team/controlled-access-runner";
import type { ControlledTeamContext } from "@/server-runtime/team-smoke";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manifest={version:2,operation:'participant_access_recovery',runId:id(1),continuationWindowId:id(2),teamId:id(3),participantId:id(4),expectedSHA:'a'.repeat(40),planSHA256:'b'.repeat(64)};
const env={APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',NODE_ENV:'production',RENDER_GIT_COMMIT:manifest.expectedSHA,TEAM_ENABLED:'true',TEAM_INVITATION_EMAIL_PROVIDER:'resend',...Object.fromEntries(['ACQUISITION_ENABLED','ACQUISITION_START_ENABLED','TEAM_CREATION_ENABLED','TEAM_INVITATIONS_ENABLED','BILLING_ENABLED','YOOKASSA_REFUNDS_ENABLED','YOOKASSA_RECONCILIATION_ENABLED'].map(key=>[key,'false']))};
const c:ControlledTeamContext={mode:'controlled',run_id:id(1),window_id:id(2),team_id:id(3),participant_id:id(4),owner_user_id:id(5),account_id:id(6),company_id:id(7),approved_plan_hash:manifest.planSHA256,expires_at:'2026-10-24T16:00:00Z',server_now:'2026-10-24T15:00:00Z'};
function fixture(){return{env,context:vi.fn(async()=>c),recover:vi.fn(async(target:{windowId:string;participantId:string})=>({...target,status:'succeeded' as const}))};}
describe('one-participant W2 access operator manifest',()=>{
 it('checks exact source/root/window/plan before calling recovery once and returns no credential',async()=>{
  const f=fixture();const result=await runControlledAccessOnce(manifest,f);
  expect(f.context).toHaveBeenCalledWith({windowId:id(2),participantId:id(4)});expect(f.recover).toHaveBeenCalledOnce();
  expect(result).toEqual({status:'CONTROLLED_TEAM_ACCESS_COMPLETED',runId:id(1),continuationWindowId:id(2),participantId:id(4),noRetryAuthorized:true});
 });
 it.each(['run_id','window_id','team_id','participant_id','approved_plan_hash'] as const)('rejects context %s mismatch before credential generation',async key=>{
  const f=fixture();f.context.mockResolvedValue({...c,[key]:key==='approved_plan_hash'?'f'.repeat(64):id(99)});
  await expect(runControlledAccessOnce(manifest,f)).rejects.toThrow('controlled_team_access_manifest_binding');expect(f.recover).not.toHaveBeenCalled();
 });
 it('rejects extra fields, missing window, another source and any open generic/financial gate',async()=>{
  const f=fixture();for(const value of [{...manifest,version:1},{...manifest,continuationWindowId:undefined},{...manifest,recipient:'new@example.test'},{...manifest,secret:'forbidden'}])await expect(runControlledAccessOnce(value,f)).rejects.toThrow();
  for(const delta of [{RENDER_GIT_COMMIT:'f'.repeat(40)},{TEAM_INVITATIONS_ENABLED:'true'},{BILLING_ENABLED:'true'},{YOOKASSA_SECRET_KEY:'synthetic-only'}])await expect(runControlledAccessOnce(manifest,{...f,env:{...env,...delta}})).rejects.toThrow();
  expect(f.context).not.toHaveBeenCalled();expect(f.recover).not.toHaveBeenCalled();
 });
 it('unknown recovery is not retried and a different success target is not accepted',async()=>{
  const f=fixture();f.recover.mockRejectedValueOnce(Error('unknown'));
  await expect(runControlledAccessOnce(manifest,f)).rejects.toThrow();expect(f.recover).toHaveBeenCalledOnce();
  f.recover.mockResolvedValueOnce({windowId:id(2),participantId:id(99),status:'succeeded'});
  await expect(runControlledAccessOnce(manifest,f)).rejects.toThrow('controlled_team_access_receipt_required');expect(f.recover).toHaveBeenCalledTimes(2);
 });
});
