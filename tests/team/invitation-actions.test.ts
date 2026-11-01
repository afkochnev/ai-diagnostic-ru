vi.mock("@/server/entitlements",()=>({requireEntitlement:vi.fn(async()=>{if(!state.entitled)throw Error("advanced_required");})}));
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({controlled:false,entitled:true,rpc:vi.fn(),send:vi.fn(),credential:vi.fn(),revalidate:vi.fn(),origin:"https://ai-diagnostic-staging-web.onrender.com",provider:"mock",cookieSet:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({origin:state.origin}),cookies:async()=>({set:state.cookieSet,get:()=>undefined})}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:state.revalidate}));
vi.mock("@/server/auth/session",()=>({requireIdentity:async()=>({user:{id:"owner",email_confirmed_at:"confirmed"}})}));
vi.mock("@/server/account/authorization",()=>({requireCompanyWrite:vi.fn(async()=>({account_id:"account"}))}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://ai-diagnostic-staging-web.onrender.com",AUTH_FLOW_SECRET:"synthetic-secret",secure:true})}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>true,teamCreationEnabled:()=>true,teamInvitationsEnabled:()=>true}));
vi.mock('@/server-runtime/team-smoke',()=>({controlledTeamRequired:()=>state.controlled,controlledTeamContext:async()=>state.controlled?{mode:'controlled'}:null}));
vi.mock("@/server/team/single-email",()=>({singleEmailCredential:state.credential}));
vi.mock("@/server/team/day-access",()=>({issueInvitationDayAccess:async(hash:string,email:string)=>({...await state.credential(hash),email,expires:Date.now()+86400000})}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:vi.fn()}));
vi.mock("@/server/team/service",()=>({teamRpc:state.rpc,invitationCompany:async()=>"Synthetic company",ownerTeam:async()=>({team:{company_id:"company",title:"Synthetic team"},participants:[{id:"10000000-0000-4000-8000-000000000001",email:"participant@example.test"}]})}));
vi.mock("@/server/team/invitation-email",async(importOriginal)=>({...await importOriginal<typeof import("@/server/team/invitation-email")>(),getTeamInvitationProvider:()=>({name:state.provider,send:state.send})}));
import { inviteTeamAction, prepareTeamInvitationAction, renewTeamInvitationAction, saveTeamResponseAction } from "@/server/team/actions";
const id="10000000-0000-4000-8000-000000000001";
function invitation() { const f=new FormData(); f.set("teamId",id); f.set("email","participant@example.test"); f.set("displayName","Participant"); return f; }
beforeEach(()=>{state.controlled=false;state.entitled=true;vi.clearAllMocks();state.origin="https://ai-diagnostic-staging-web.onrender.com";state.provider="mock";state.rpc.mockResolvedValue(id);state.send.mockResolvedValue({providerMessageId:"synthetic-receipt"});state.credential.mockResolvedValue({email:"participant@example.test",envelope:"synthetic-private-proof"});});
describe("team invitation side effects",()=>{
  it("sends one email only after scoped invitation creation, binding recipient and token hash",async()=>{
    const result=await inviteTeamAction({},invitation());
    expect(result.emailStatus).toBe("mock"); expect(state.rpc).toHaveBeenCalledTimes(1); expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.credential).not.toHaveBeenCalled();
    expect(state.send.mock.calls[0][0]).toMatchObject({to:"participant@example.test",subject:"Приглашение в командную диагностику — Synthetic company"});
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

it("hides the raw link on successful real invitation delivery",async()=>{
 state.provider="resend";const result=await inviteTeamAction({},invitation());
 expect(result).toMatchObject({emailStatus:"sent",recipient:"participant@example.test",providerMessageId:"synthetic-receipt"});
 expect(result).not.toHaveProperty("invitationUrl");expect(state.send).toHaveBeenCalledOnce();
 expect(state.send.mock.calls[0][0].html).toContain("Принять приглашение");
 expect(state.send.mock.calls[0][0].text).toContain("&auth=synthetic-private-proof");
 expect(JSON.stringify(result)).not.toContain("synthetic-private-proof");
});
it("never returns the mailed Auth credential to the owner even when real delivery fails",async()=>{
 state.provider="resend";state.send.mockRejectedValue(Error("provider secret"));
 const result=await inviteTeamAction({},invitation());
 expect(result.emailStatus).toBe("failed");expect(result.invitationUrl).toContain("#invitation=");
 expect(JSON.stringify(result)).not.toContain("synthetic-private-proof");expect(result.invitationUrl).not.toContain("&auth=");
});
it('controlled uncertain delivery exposes neither a fallback invitation URL nor an Auth credential',async()=>{
 state.controlled=true;state.provider='resend';state.send.mockRejectedValue(Error('private provider data'));
 const result=await inviteTeamAction({},invitation());
 expect(result.emailStatus).toBe('failed');expect(result).not.toHaveProperty('invitationUrl');expect(JSON.stringify(result)).not.toContain('synthetic-private-proof');
 const f=new FormData();f.set('teamId',id);f.set('participantId',id);state.rpc.mockClear();state.send.mockClear();
 expect((await renewTeamInvitationAction({},f)).error).toBeTruthy();expect(state.rpc).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
});
it("renewal rotates the hash through the existing RPC and sends one replacement without creating a participant",async()=>{
 const first=await inviteTeamAction({},invitation());const oldHash=state.rpc.mock.calls[0][1].p_token_hash;
 state.rpc.mockClear();state.send.mockClear();const f=new FormData();f.set("teamId",id);f.set("participantId",id);
 const renewed=await renewTeamInvitationAction({},f);
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("renew_team_invitation",{p_participant_id:id,p_token_hash:expect.any(String)});
 expect(state.rpc.mock.calls[0][1].p_token_hash).not.toBe(oldHash);expect(renewed.invitationUrl).not.toBe(first.invitationUrl);expect(state.send).toHaveBeenCalledOnce();
});

it("denies new Free invitations before RPC or email side effects",async()=>{
 state.entitled=false;const result=await inviteTeamAction({},invitation());
 expect(result.error).toContain("Advanced");expect(state.rpc).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
});
it("keeps existing invitation renewal available after downgrade",async()=>{
 state.entitled=false;const f=invitation();f.set("participantId",id);
 const result=await renewTeamInvitationAction({},f);
 expect(result.emailStatus).toBe("mock");expect(state.rpc.mock.calls[0][0]).toBe("renew_team_invitation");
});
