import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({rpc:fixture.rpc})}));
import {teamProductEnabled,teamCreationEnabled,teamInvitationsEnabled} from '@/server-runtime/launch-gates';
import {controlledTeamRequired,controlledTeamContext,reserveControlledTeamEffect,assertControlledTeamEffectWindow} from '@/server-runtime/team-smoke';
import {processTeamJob,runTeamJobs} from '@/server/team/worker';
const production={NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',TEAM_ENABLED:'true',TEAM_PRODUCT_ENABLED:'true'};
beforeEach(()=>{fixture.rpc.mockReset();for(const[k,v]of Object.entries(production))vi.stubEnv(k,v);});
afterEach(()=>vi.unstubAllEnvs());
describe('explicit ordinary Team product mode',()=>{
 it('requires the production identity, foundation flag and explicit release flag',()=>{
  expect(teamProductEnabled(production)).toBe(true);
  for(const delta of [{TEAM_PRODUCT_ENABLED:undefined},{TEAM_PRODUCT_ENABLED:'false'},{TEAM_ENABLED:'false'},{NODE_ENV:'development'},{APP_URL:'https://other.example.test'},{SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'}])expect(teamProductEnabled({...production,...delta})).toBe(false);
  expect(controlledTeamRequired(production)).toBe(false);
  expect(controlledTeamRequired({...production,TEAM_PRODUCT_ENABLED:'false'})).toBe(true);
  expect(()=>controlledTeamRequired({...production,SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'})).toThrow('controlled_team_unavailable');
 });
 it('keeps creation and invitation pauses independent from existing work',()=>{
  const paused={...production,TEAM_CREATION_ENABLED:'false',TEAM_INVITATIONS_ENABLED:'false'};
  expect(teamProductEnabled(paused)).toBe(true);expect(teamCreationEnabled(paused)).toBe(false);expect(teamInvitationsEnabled(paused)).toBe(false);
 });
 it('uses the existing ordinary effect paths without requesting a historical run',async()=>{
  expect(await controlledTeamContext({teamId:'10000000-0000-4000-8000-000000000001'})).toBeNull();
  expect(await reserveControlledTeamEffect(null,'pdf',{reportId:'20000000-0000-4000-8000-000000000001'})).toBeNull();
  expect(()=>assertControlledTeamEffectWindow(null)).not.toThrow();expect(fixture.rpc).not.toHaveBeenCalled();
  vi.stubEnv('TEAM_PRODUCT_ENABLED','false');expect(()=>assertControlledTeamEffectWindow(null)).toThrow('controlled_team_unavailable');
 });
 it('lets the ordinary worker claim and aggregate a normal production job',async()=>{
  const job={id:'job',kind:'team_aggregate',lease_token:'lease',attempts:1,controlled_run_id:null,controlled_window_id:null};
  fixture.rpc.mockImplementation(async(name:string)=>({data:name==='claim_team_jobs_v3'?[job]:'completed',error:null}));
  expect(await runTeamJobs()).toBe(1);
  expect(fixture.rpc.mock.calls.map(call=>call[0])).toEqual(['claim_team_jobs_v3','process_team_aggregate']);
 });
 it('does not let the normal worker consume a historical controlled job',async()=>{
  const rpc=vi.fn();
  for(const ids of [{controlled_run_id:'historical-run'},{controlled_window_id:'historical-window'}])await expect(processTeamJob({id:'job',kind:'team_aggregate',lease_token:'lease',attempts:1,...ids},rpc)).rejects.toThrow('controlled_team_claim_required');
  expect(rpc).not.toHaveBeenCalled();
 });
 it('keeps the global production Team loop closed before explicit product release',async()=>{
  vi.stubEnv('TEAM_PRODUCT_ENABLED','false');expect(await runTeamJobs()).toBe(0);expect(fixture.rpc).not.toHaveBeenCalled();
 });
});
