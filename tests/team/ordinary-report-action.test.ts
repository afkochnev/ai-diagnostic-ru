import { beforeEach,afterEach,it,expect,vi } from "vitest";
const s=vi.hoisted(()=>({rpc:vi.fn(),owner:true,allowed:true,origin:"https://ai-diagnostic-staging-web.onrender.com"}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({origin:s.origin}),cookies:async()=>({})}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/server/auth/session",()=>({requireIdentity:async()=>({user:{id:"owner"}})}));
vi.mock("@/server/account/authorization",()=>({requireCompanyWrite:async()=>{if(!s.allowed)throw Error("advanced_required");return {account_id:"account"};}}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://ai-diagnostic-staging-web.onrender.com"})}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>true}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:vi.fn()}));
vi.mock("@/server/team/service",()=>({teamRpc:s.rpc,ownerTeam:async()=>s.owner?{team:{company_id:"company"}}:null}));
import { teamResultAction } from "@/server/team/actions";
const form=()=>{const f=new FormData();f.set("teamId","10000000-0000-4000-8000-000000000001");f.set("intent","report");f.set("p_provider","mock");return f;};
beforeEach(()=>{vi.clearAllMocks();s.owner=true;s.allowed=true;s.origin="https://ai-diagnostic-staging-web.onrender.com";vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-not-used");s.rpc.mockResolvedValue("requested");});
afterEach(()=>vi.unstubAllEnvs());
it("uses server openai policy despite a client mock argument, preserving scoped RPC",async()=>{
  expect(await teamResultAction({},form())).toEqual({status:"requested"});expect(s.rpc).toHaveBeenCalledExactlyOnceWith("request_team_report_v3",{p_team_id:"10000000-0000-4000-8000-000000000001",p_provider:"openai"});
});
it("does not create any report in mock mode",async()=>{vi.stubEnv("TEAM_AI_PROVIDER","mock");expect((await teamResultAction({},form())).error).toContain("реального AI");expect(s.rpc).not.toHaveBeenCalled();});
it("preserves owner, origin and write authorization before side effects",async()=>{
  s.owner=false;await teamResultAction({},form());expect(s.rpc).not.toHaveBeenCalled();
  s.owner=true;s.allowed=false;await teamResultAction({},form());expect(s.rpc).not.toHaveBeenCalled();
  s.allowed=true;s.origin="https://foreign.example.test";await teamResultAction({},form());expect(s.rpc).not.toHaveBeenCalled();
});
it("preserves database entitlement denials without silently switching provider",async()=>{s.rpc.mockRejectedValueOnce(new Error("advanced_required"));expect((await teamResultAction({},form())).error).toContain("Advanced");expect(s.rpc).toHaveBeenCalledTimes(1);});
