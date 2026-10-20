import {beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn()}));vi.mock("server-only",()=>({}));
vi.mock("@/server/auth/admin",()=>({requireAdmin:mocks.admin}));vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({rpc:mocks.rpc})}));
import {adminList,adminTeamSchema,adminMetrics} from "@/server/admin/console";
const aid="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({});mocks.rpc.mockResolvedValue({data:{rows:[],total:0,page:1,page_size:25},error:null});});
describe("V2.4 bounded administrative projections",()=>{
 it("uses cookie-scoped RPC after the administrator boundary and retains search filters",async()=>{const r=await adminList("accounts",{q:"Компания",page:2,plan:"free"});expect(r.rows).toEqual([]);expect(mocks.rpc).toHaveBeenCalledWith("read_admin_console",{p_section:"accounts",p_id:null,p_filters:{q:"Компания",page:2,plan:"free"}});});
 it("denies invalid inputs without requesting data",async()=>{await expect(adminList("accounts",{page:0})).rejects.toThrow("admin_invalid_filter");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("does not cap Auth metrics at 1000 identities",async()=>{mocks.rpc.mockResolvedValue({data:{application_users:1200,auth_identities:1300,funnel:{started:10,completed:5}},error:null});expect(await adminMetrics()).toMatchObject({application_users:1200,auth_identities:1300});});
 it("strips unexpected source material from Team operational rows",()=>{const parsed=adminTeamSchema.parse({item:{id:aid,created_at:"2026-10-20",answers:{secret:"private"}},result:null,report:null,pdfs:[],privacy_corpus:"hidden"});expect(JSON.stringify(parsed)).not.toContain("secret");expect(JSON.stringify(parsed)).not.toContain("privacy_corpus");});
 it("contains no private Team answer/synthesis read or job mutation in the admin migration",()=>{const sql=readFileSync("supabase/migrations/20261020170720_v24_admin_console_and_plan_audit.sql","utf8");for(const forbidden of ["private.team_responses","private.team_qualitative_syntheses","lease_token","update public.jobs","update private.team_jobs"])expect(sql).not.toContain(forbidden);expect(sql).toContain("set search_path=''");expect(sql).toContain("admin_plan_changes");expect(sql).toContain("for update");expect(sql).not.toContain("create or replace function private.is_administrator");});
});
