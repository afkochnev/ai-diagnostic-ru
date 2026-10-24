import {it,expect,vi} from 'vitest';
import {createControlledTeamRpc} from '@/server/team/controlled-rpc';
const url='https://fhvxqeaujjeiflanqsbg.supabase.co';
it('allows only reviewed exact production RPC POST paths, rejects redirects and unknown outcomes without retries',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response('{"status":"stopped"}',{status:200}));
 const rpc=createControlledTeamRpc({url,serviceKey:'synthetic-only-key',fetch});
 expect(await rpc('stop_controlled_team_run',{p_run_id:'synthetic'})).toEqual({data:{status:'stopped'},error:null});
 expect(fetch.mock.calls[0][0]).toBe(url+'/rest/v1/rpc/stop_controlled_team_run');expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error'});
 await expect(rpc('request_team_report_v3',{})).rejects.toThrow('controlled_team_rpc_scope');expect(fetch).toHaveBeenCalledOnce();
 fetch.mockRejectedValueOnce(Error('secret provider body'));expect(await rpc('claim_controlled_team_job',{})).toEqual({data:null,error:{message:'controlled_team_rpc_unknown'}});expect(fetch).toHaveBeenCalledTimes(2);
 expect(()=>createControlledTeamRpc({url:'https://wrong.example',serviceKey:'synthetic',fetch})).toThrow();
});
it('shutdown stops new claims but still permits bounded cleanup RPCs',async()=>{
 const c=new AbortController();c.abort();const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response('null',{status:200}));const rpc=createControlledTeamRpc({url,serviceKey:'synthetic',fetch,signal:c.signal});
 expect(await rpc('claim_controlled_team_job',{})).toEqual({data:null,error:{message:'controlled_team_rpc_unknown'}});expect(fetch).not.toHaveBeenCalled();
 expect(await rpc('fail_team_job',{})).toEqual({data:null,error:null});expect(fetch).toHaveBeenCalledOnce();
});
it('allows only explicit W2 worker RPCs and permits stop after shutdown without granting operator configuration',async()=>{
 const controller=new AbortController();
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response('{"status":"stopped"}',{status:200}));
 const rpc=createControlledTeamRpc({url,serviceKey:'synthetic-only',fetch,signal:controller.signal});
 for(const name of ['claim_controlled_team_window_job','reserve_controlled_team_window_ai_call'])expect((await rpc(name,{})).error).toBeNull();
 for(const name of ['configure_controlled_team_w2','arm_controlled_team_w2','reserve_controlled_team_w2_access','terminalize_controlled_team_window_jobs'])await expect(rpc(name,{})).rejects.toThrow('controlled_team_rpc_scope');
 controller.abort();
 expect((await rpc('claim_controlled_team_window_job',{})).error).not.toBeNull();
 expect((await rpc('stop_controlled_team_window',{})).error).toBeNull();
 expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([200, 204])('accepts an empty HTTP %i body only for the SQL-void failure RPC', async status => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
  const rpc = createControlledTeamRpc({ url, serviceKey: 'synthetic', fetch });
  expect(await rpc('fail_team_job', {})).toEqual({ data: null, error: null });
  expect(await rpc('stop_controlled_team_run', {})).toEqual({
    data: null,
    error: { message: 'controlled_team_rpc_unknown' },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
