import { it,expect,vi } from "vitest";
import { privateManagementQuery,compareSource,FOODTECH } from "../../scripts/foodtech-quality-source";

it("uses the existing private credential only against the pinned staging API, read-only, without retries",async()=>{
 const fetcher=vi.fn(async()=>new Response('[{"ok":true}]',{status:201}));
 const port=privateManagementQuery(fetcher,()=>"sbp_dummy_transport_only");
 expect(await port.query("select true as ok")).toEqual([{ok:true}]);
 const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe(`https://api.supabase.com/v1/projects/${FOODTECH.project}/database/query`);
 expect(request.redirect).toBe("error");expect(JSON.parse(request.body as string)).toEqual({query:"begin transaction isolation level repeatable read read only; select true as ok; rollback;",read_only:false});
 for(const query of ["update public.team_diagnostics set status='closed'","select 1; commit; delete from public.team_diagnostics","set role postgres"]){await expect(port.query(query)).rejects.toThrow("foodtech_readonly_query_required");}
 port.close();await expect(port.query("select 1")).rejects.toThrow("foodtech_source_unavailable");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("never exposes provider bodies, SQL or credentials in a failure",async()=>{
 const fetcher=vi.fn(async()=>new Response('query: PRIVATE_CONTENT secret sbp_dummy',{status:403}));
 const port=privateManagementQuery(fetcher,()=>"sbp_dummy_transport_only");
 await expect(port.query("select 'PRIVATE_CONTENT'")).rejects.toThrow(/^foodtech_source_unavailable$/);expect(fetcher).toHaveBeenCalledTimes(1);port.close();
});
it("rejects another team, changed replies or historical reports before accepting a source",()=>{
 const expected={id:FOODTECH.team,company_id:FOODTECH.company,account_id:"fixture",owner_email:FOODTECH.owner,status:"open",completed_count:3,fingerprint:"fixture",question_count:80,reports_count:3,historical_reports_guard:"old",response_guard:"answers",validator_md5:"e4d4af7584217930c88a370d45f80b7e"};
 expect(()=>compareSource(expected,expected)).not.toThrow();
 for(const changed of [{id:"another"},{response_guard:"changed"},{historical_reports_guard:"changed"},{completed_count:4}])expect(()=>compareSource({...expected,...changed},expected)).toThrow("foodtech_source_changed");
});
