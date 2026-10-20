import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("react",()=>({cache:(fn:unknown)=>fn}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error("redirect:"+path);}}));
vi.mock("@/server/auth/session",()=>({getIdentity:mocks.identity}));
vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({rpc:mocks.rpc})}));
import {requireAdmin} from "@/server/auth/admin";
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({user:{id:"admin",email_confirmed_at:"2026-10-20"},role:"administrator",aal:"aal1"});mocks.rpc.mockResolvedValue({data:{administrator:true},error:null});});
describe("V2.4 administrator boundary",()=>{
 it("accepts owner-approved aal1 only after a live DB administrator check",async()=>{await expect(requireAdmin()).resolves.toMatchObject({role:"administrator",aal:"aal1"});expect(mocks.rpc).toHaveBeenCalledWith("read_admin_console",{p_section:"identity"});});
 it.each([[null,"/ru/login"],[{user:{id:"x",email_confirmed_at:null},role:"administrator"},"/ru/verify-email"],[{user:{id:"x",email_confirmed_at:"yes"},role:"user"},"/ru/access-denied"]])("denies absent, unconfirmed and ordinary identities",async(identity,path)=>{mocks.identity.mockResolvedValue(identity);await expect(requireAdmin()).rejects.toThrow("redirect:"+path);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("denies an expired or revoked DB session even if the local role looked valid",async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:"admin_access_denied"}});await expect(requireAdmin()).rejects.toThrow("redirect:/ru/access-denied");});
});
