import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn(),origin:vi.fn(),revalidate:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("@/server/auth/admin",()=>({requireAdmin:mocks.admin}));
vi.mock("next/headers",()=>({headers:async()=>({get:mocks.origin})}));vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://staging.example.test"})}));
vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({rpc:mocks.rpc})}));
import {changeAdminPlan} from "@/server/admin/plan-actions";
const aid="10000000-0000-4000-8000-000000000001";
function form(values:Record<string,string|undefined>={}){const f=new FormData();for(const [k,v]of Object.entries({account:aid,target:"advanced",expected:"free",reason:"Проверка синтетического аккаунта",confirm:"on",...values}))f.set(k,v??"");return f;}
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({user:{id:"admin"}});mocks.origin.mockReturnValue("https://staging.example.test");mocks.rpc.mockResolvedValue({data:{status:"changed",plan:"advanced"},error:null});});
describe("manual Account plan mutation",()=>{
 it("denies ordinary callers before the mutation",async()=>{mocks.admin.mockRejectedValue(Error("denied"));await expect(changeAdminPlan({},form())).rejects.toThrow("denied");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("denies a cross-origin action",async()=>{mocks.origin.mockReturnValue("https://foreign.example.test");expect(await changeAdminPlan({},form())).toHaveProperty("error");expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each([{target:"invented"},{expected:"forged"},{account:"not-uuid"},{reason:""},{reason:"x"},{reason:"x".repeat(501)},{confirm:""}])("rejects an invalid or unconfirmed transition",async values=>{expect(await changeAdminPlan({},form(values))).toHaveProperty("error");expect(mocks.rpc).not.toHaveBeenCalled();});
 it("sends only validated identity-free arguments to the atomic DB operation",async()=>{expect(await changeAdminPlan({},form())).toHaveProperty("success");expect(mocks.rpc).toHaveBeenCalledWith("admin_assign_account_plan",{p_account_id:aid,p_target_plan:"advanced",p_expected_plan:"free",p_reason:"Проверка синтетического аккаунта"});expect(mocks.revalidate).toHaveBeenCalled();});
 it("handles stale state without retrying or exposing provider bodies",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"admin_plan_changed_refresh private body should not appear"}});const state=await changeAdminPlan({},form());expect(state.error).toContain("Обновите страницу");expect(JSON.stringify(state)).not.toContain("private body");expect(mocks.rpc).toHaveBeenCalledOnce();});
});
