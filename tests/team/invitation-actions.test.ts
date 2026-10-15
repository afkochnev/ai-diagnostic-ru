import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn(),revalidate:vi.fn(),origin:"https://ai-diagnostic-staging-web.onrender.com",provider:"mock",cookieSet:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({origin:state.origin}),cookies:async()=>({set:state.cookieSet,get:()=>undefined})}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:state.revalidate}));
vi.mock("@/server/auth/session",()=>({requireIdentity:async()=>({user:{id:"owner",email_confirmed_at:"confirmed"}})}));
vi.mock("@/server/account/authorization",()=>({requireCompanyWrite:vi.fn()}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://ai-diagnostic-staging-web.onrender.com",AUTH_FLOW_SECRET:"synthetic-secret",secure:true})}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>true}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:vi.fn()}));
vi.mock("@/server/team/service",()=>({teamRpc:state.rpc,ownerTeam:async()=>({team:{company_id:"company",title:"Synthetic team"},participants:[]})}));
vi.mock("@/server/consultation/provider",()=>({getConsultationProvider:()=>({name:state.provider,send:state.send})}));
import { inviteTeamAction, prepareTeamInvitationAction, saveTeamResponseAction } from "@/server/team/actions";
const id="10000000-0000-4000-8000-000000000001";
function invitation() { const f=new FormData(); f.set("teamId",id); f.set("email","participant@example.test"); f.set("displayName","Participant"); return f; }
beforeEach(()=>{vi.clearAllMocks();state.origin="https://ai-diagnostic-staging-web.onrender.com";state.provider="mock";state.rpc.mockResolvedValue(id);state.send.mockResolvedValue({providerMessageId:"synthetic-receipt"});});
describe("team invitation side effects",()=>{
  it("sends one email only after scoped invitation creation, binding recipient and token hash",async()=>{
    const result=await inviteTeamAction({},invitation());
    expect(result.emailStatus).toBe("mock"); expect(state.rpc).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({to:"participant@example.test",subject:"Приглашение: Synthetic team"});
    expect(state.send.mock.calls[0][0].text).toContain(result.invitationUrl);
    expect(state.rpc.mock.calls[0][0]).toBe("invite_team_participant");
    const link=new URL(result.invitationUrl!);
    expect(link.search).toBe("");
    const token=new URLSearchParams(link.hash.slice(1)).get("invitation")!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(state.rpc.mock.calls[0][1].p_token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(state.rpc.mock.calls[0][1])).not.toContain(token);
    expect(state.rpc.mock.calls[0][1]).not.toHaveProperty("answers");
  });
  it("does not send another invitation when the database rejects a duplicate",async()=>{
    state.rpc.mockRejectedValue(new Error("team_already_invited"));
    const result=await inviteTeamAction({},invitation());
    expect(result.error).toContain("уже приглашён");expect(state.send).not.toHaveBeenCalled();
  });
  it("shows real provider failure while preserving the once-issued link",async()=>{
    state.send.mockRejectedValue(new Error("sensitive provider response"));
    const result=await inviteTeamAction({},invitation());
    expect(result.emailStatus).toBe("failed");expect(result.invitationUrl).toContain("#invitation=");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it("rejects another origin before database or provider access",async()=>{
    state.origin="https://foreign.example.test";
    expect((await inviteTeamAction({},invitation())).error).toBeTruthy();expect(state.rpc).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
  });
  it("keeps pending invitation in an encrypted, short-lived HttpOnly cookie across sign-in",async()=>{
    const f=new FormData();f.set("token","a".repeat(64));
    expect(await prepareTeamInvitationAction({},f)).toEqual({status:"prepared"});
    expect(state.cookieSet.mock.calls[0][2]).toMatchObject({httpOnly:true,sameSite:"lax",secure:true,path:"/ru",maxAge:1800});
    expect(state.cookieSet.mock.calls[0][1]).not.toContain("a".repeat(64));
    expect(state.rpc).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
  });
});

it("retains the last saved revision across a validation error so correction can be submitted",async()=>{
  const f=new FormData();f.set("participantId",id);f.set("revision","3");f.set("answers","{}");f.set("intent","submit");
  state.rpc.mockRejectedValue(new Error("team_required_answers_missing"));
  const result=await saveTeamResponseAction({revision:3,status:"started"},f);
  expect(result).toMatchObject({revision:3,status:"started"});expect(result.error).toContain("обязательные");
  state.rpc.mockResolvedValue({revision:4,status:"completed"});
  expect(await saveTeamResponseAction(result,f)).toEqual({revision:4,status:"completed"});
  expect(state.rpc.mock.calls[1][1].p_expected_revision).toBe(3);
});
