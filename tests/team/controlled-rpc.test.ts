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
