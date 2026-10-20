import {beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({context:vi.fn(),current:vi.fn(),verify:vi.fn(),rpc:vi.fn(),clear:vi.fn(),limit:vi.fn(),redirect:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({redirect:state.redirect}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/server/team/entry-context",()=>({teamEntryContext:state.context,clearTeamEntry:state.clear}));
vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({auth:{getUser:state.current,verifyOtp:state.verify}})}));
vi.mock("@/server/auth/legal",()=>({registrationPolicy:async()=>({versions:{data_processing:"v1",marketing:"v1"}})}));
vi.mock("@/server/auth/recovery",()=>({clearRecovery:vi.fn()}));
vi.mock("@/server/team/service",()=>({teamRpc:state.rpc}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:state.limit}));
import {continueSingleEmailAction} from "@/server/team/single-email-actions";
const email="participant@example.test",token="a".repeat(64),hash="b".repeat(64),tokenHash="c".repeat(64),pid="10000000-0000-4000-8000-000000000099";
const context=()=>({token,hash,target:{email},proof:{email,tokenHash,type:"invite"}});
function consent(){const f=new FormData();f.set("data_processing_consent","on");f.set("data_processing_version","v1");f.set("marketing_version","v1");return f;}
beforeEach(()=>{
 vi.clearAllMocks();state.context.mockResolvedValue(context());state.current.mockResolvedValue({data:{user:null}});
 state.verify.mockResolvedValue({data:{session:{},user:{email,email_confirmed_at:"confirmed"}},error:null});
 state.rpc.mockResolvedValue(pid);state.limit.mockResolvedValue(undefined);state.redirect.mockImplementation((url)=>{throw Error("redirect:"+url);});
});
describe("single email consent continuation",()=>{
 it("verifies Supabase proof and atomically provisions/accepts only after consent, then redirects",async()=>{
  await expect(continueSingleEmailAction({},consent())).rejects.toThrow("redirect:/ru/team/responses/"+pid);
  expect(state.context).toHaveBeenCalledWith(true);
  expect(state.verify).toHaveBeenCalledExactlyOnceWith({token_hash:tokenHash,type:"invite"});
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("finalize_team_invitation_identity",{p_token:token,p_consent:true,p_data_version:"v1",p_marketing_version:"v1"});
  expect(state.clear).toHaveBeenCalledOnce();
 });
 it.each(["missing","policy"])("rejects %s consent before Auth verification or identity provisioning",async(kind)=>{
  const f=consent();if(kind==="missing")f.delete("data_processing_consent");else f.set("data_processing_version","old");
  expect((await continueSingleEmailAction({},f)).error).toBeTruthy();
  expect(state.verify).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
 });
 it("a matching verified session needs neither another Auth email nor another verification",async()=>{
  state.current.mockResolvedValue({data:{user:{email,email_confirmed_at:"confirmed"}}});
  await expect(continueSingleEmailAction({},consent())).rejects.toThrow("redirect:");
  expect(state.verify).not.toHaveBeenCalled();expect(state.rpc).toHaveBeenCalledOnce();
 });
 it("blocks a wrong browser session before consuming the mailed proof",async()=>{
  state.current.mockResolvedValue({data:{user:{email:"owner@example.test",email_confirmed_at:"confirmed"}}});
  expect((await continueSingleEmailAction({},consent())).phase).toBe("wrong");
  expect(state.verify).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();expect(state.clear).not.toHaveBeenCalled();
 });
 it.each(["no_proof","expired","revoked"])("rejects %s context without touching Auth",async(kind)=>{
  if(kind==="no_proof")state.context.mockResolvedValue({...context(),proof:null});else state.context.mockRejectedValue(Error(kind==="expired"?"team_context_expired":"team_invitation_unavailable"));
  expect((await continueSingleEmailAction({},consent())).phase).toBe("expired");
  expect(state.verify).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();expect(state.clear).toHaveBeenCalledOnce();
 });
 it.each(["error","unconfirmed","wrong_recipient","no_session"])("refuses %s proof before provisioning or acceptance",async(kind)=>{
  state.verify.mockResolvedValue({data:{session:kind==="no_session"?null:{},user:{email:kind==="wrong_recipient"?"other@example.test":email,email_confirmed_at:kind==="unconfirmed"?null:"confirmed"}},error:kind==="error"?{message:"private provider details"}:null});
  const result=await continueSingleEmailAction({},consent());expect(result.phase).toBe("expired");expect(result.error).not.toContain("private");expect(state.rpc).not.toHaveBeenCalled();
 });
 it("does not claim acceptance after a closed/revoked race or database failure",async()=>{
  state.rpc.mockRejectedValue(Error("team_invitation_unavailable"));
  expect((await continueSingleEmailAction({},consent())).phase).toBe("expired");expect(state.redirect).not.toHaveBeenCalled();
 });
 it("rate limiting prevents credential consumption",async()=>{
  state.limit.mockRejectedValue(Error("rate_limited"));
  expect((await continueSingleEmailAction({},consent())).phase).toBe("error");expect(state.verify).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
 });
});
