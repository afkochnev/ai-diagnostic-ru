import {beforeEach,expect,it,vi} from 'vitest';
import {reportFixture} from '../team/v3-fixtures';
const s=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),render:vi.fn(),context:vi.fn(),reserve:vi.fn(),complete:vi.fn(),window:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server/account/authorization',()=>({authenticatedAccountClient:s.auth}));
vi.mock('@/server/supabase/admin',()=>({createAdminClient:s.admin}));
vi.mock('@/server/team/pdf-render',()=>({renderTeamPdf:s.render}));
vi.mock('@/server-runtime/team-smoke',()=>({controlledTeamRequired:()=>true,controlledTeamContext:s.context,reserveControlledTeamEffect:s.reserve,assertControlledTeamEffectWindow:s.window,completeControlledTeamEffect:s.complete}));
import {getTeamPdf,prepareTeamPdf} from '@/server/team/pdf-service';
const id='10000000-0000-4000-8000-000000000001',owner='20000000-0000-4000-8000-000000000002';
let artifact:Record<string,unknown>|null,spent:boolean;
const source=()=>({report_id:id,version:1,pipeline:'TEAM-RU-3',model:'gpt-5.6-sol',completed_at:'2026-10-23T19:00:00Z',company_name:'Synthetic',team_title:'Controlled',participant_count:3,overall:{mean:50,maturity:'Зона развития'},blocks:Array.from({length:8},(_,i)=>({title:`Блок ${i+1}`,mean:50})),content:{...reportFixture(),participant_count:3}});
beforeEach(()=>{
 vi.clearAllMocks();artifact=null;spent=false;
 const chain={select:()=>chain,eq:()=>chain,single:async()=>({data:{team_diagnostic_id:id},error:null})};
 s.auth.mockResolvedValue({rpc:async()=>({data:source(),error:null}),from:()=>chain});
 s.admin.mockReturnValue({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:artifact,error:null}),upsert:async(row:Record<string,unknown>)=>{artifact??=row;return {error:null};}};return q;}});
 s.context.mockResolvedValue({run_id:id,team_id:id});
 s.reserve.mockImplementation(async()=>{if(spent)throw Error('controlled_team_budget_consumed');spent=true;return {reservation_id:id};});
 s.complete.mockResolvedValue(undefined);s.render.mockResolvedValue(Buffer.from('%PDF-1.7 synthetic controlled'));
});
it('reserves exactly one prepare before rendering/writing and reuses ready bytes without another reservation',async()=>{
 await Promise.all([prepareTeamPdf(id,owner),prepareTeamPdf(id,owner)]);
 expect(s.reserve).toHaveBeenCalledExactlyOnceWith({run_id:id,team_id:id},'pdf',{reportId:id});
 expect(s.context).toHaveBeenCalledExactlyOnceWith({teamId:id,ownerUserId:owner});
 expect(s.render).toHaveBeenCalledOnce();expect(s.reserve.mock.invocationCallOrder[0]).toBeLessThan(s.render.mock.invocationCallOrder[0]);
 expect(s.complete).toHaveBeenCalledWith({reservation_id:id},'succeeded',expect.stringMatching(/^[a-f0-9]{64}$/));
 await prepareTeamPdf(id,owner);await getTeamPdf(id,owner);
 expect(s.reserve).toHaveBeenCalledOnce();expect(s.render).toHaveBeenCalledOnce();
});
it('render failure spends the durable slot and cannot automatically prepare again on a later request',async()=>{
 s.render.mockRejectedValueOnce(Error('synthetic rendering failure'));
 await expect(prepareTeamPdf(id,owner)).rejects.toThrow('synthetic rendering failure');
 expect(s.complete).toHaveBeenCalledWith({reservation_id:id},'failed');
 await expect(prepareTeamPdf(id,owner)).rejects.toThrow('controlled_team_budget_consumed');
 expect(s.render).toHaveBeenCalledOnce();expect(artifact).toBeNull();
});
it('an unavailable reservation blocks rendering and does not write a PDF',async()=>{
 s.reserve.mockRejectedValue(Error('controlled_team_unavailable'));
 await expect(prepareTeamPdf(id,owner)).rejects.toThrow('controlled_team_unavailable');
 expect(s.render).not.toHaveBeenCalled();expect(artifact).toBeNull();
});
it('an expired effect cannot render or publish',async()=>{
 s.window.mockImplementationOnce(()=>{throw Error('controlled_team_unavailable');});
 await expect(prepareTeamPdf(id,owner)).rejects.toThrow('controlled_team_unavailable');
 expect(s.render).not.toHaveBeenCalled();expect(artifact).toBeNull();
});
it('an uncertain completion receipt does not replace a ready PDF or cause a second render',async()=>{
 s.complete.mockRejectedValueOnce(Error('controlled_team_effect_unconfirmed'));
 await expect(prepareTeamPdf(id,owner)).rejects.toThrow('controlled_team_effect_unconfirmed');
 expect(artifact).not.toBeNull();
 await expect(getTeamPdf(id,owner)).resolves.toMatchObject({fileName:'team-management-ai-audit-synthetic-v1.pdf'});
 await prepareTeamPdf(id,owner);
 expect(s.render).toHaveBeenCalledOnce();expect(s.reserve).toHaveBeenCalledOnce();
});
