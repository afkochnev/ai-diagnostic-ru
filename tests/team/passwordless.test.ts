import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({jar:new Map<string,string>(),origin:"https://ai-diagnostic-staging-web.onrender.com",enabled:true,resolve:vi.fn(),send:vi.fn(),verify:vi.fn(),accept:vi.fn(),limit:vi.fn(),identity:vi.fn(),current:vi.fn(),user:vi.fn(),redirect:vi.fn(),set:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({origin:state.origin}),cookies:async()=>({get:(key:string)=>state.jar.has(key)?{value:state.jar.get(key)}:undefined,set:(key:string,value:string,options:unknown)=>{state.jar.set(key,value);state.set(key,value,options);},delete:(key:string)=>state.jar.delete(key)})}));
vi.mock("next/navigation",()=>({redirect:state.redirect}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/server-runtime/supabase/admin",()=>({createAdminClient:()=>({rpc:state.resolve})}));
vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({auth:{signInWithOtp:state.send,verifyOtp:state.verify,getUser:state.user}})}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://ai-diagnostic-staging-web.onrender.com",AUTH_FLOW_SECRET:"synthetic-secret",secure:true})}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>state.enabled}));
vi.mock("@/server/auth/session",()=>({requireIdentity:state.identity,getIdentity:state.current}));
vi.mock("@/server/auth/legal",()=>({registrationPolicy:async()=>({versions:{data_processing:"v1",marketing:"v1"}})}));
vi.mock("@/server/team/service",()=>({teamRpc:state.accept}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:state.limit}));
import { sendTeamCodeAction,verifyTeamCodeAction,confirmTeamEmailAction } from "@/server/team/passwordless-actions";
import { sealInvitation } from "@/server/team/invitation-envelope";
import { sealTeamChallenge,openTeamChallenge } from "@/server/team/passwordless-challenge";
const token="a".repeat(64),hash=createHash("sha256").update(token).digest("hex"),email="participant@example.test",secret="synthetic-secret";
function consent(){const f=new FormData();f.set("data_processing_consent","on");f.set("data_processing_version","v1");f.set("marketing_version","v1");return f;}
function code(value="123456"){const f=new FormData();f.set("code",value);return f;}
function challenge(){state.jar.set("team-email-challenge",sealTeamChallenge(email,hash,secret));}
beforeEach(()=>{
 vi.clearAllMocks();state.jar.clear();state.origin="https://ai-diagnostic-staging-web.onrender.com";state.enabled=true;
 state.jar.set("team-invitation",sealInvitation(token,secret));
 state.resolve.mockResolvedValue({data:{email,display_name:"Invited participant",create_user:false},error:null});state.send.mockResolvedValue({error:null});
 state.verify.mockResolvedValue({data:{session:{access_token:"synthetic"},user:{email,email_confirmed_at:"confirmed"}},error:null});
 state.limit.mockResolvedValue(undefined);state.identity.mockResolvedValue({user:{id:"participant-user",email}});state.current.mockResolvedValue(null);state.user.mockResolvedValue({data:{user:{email,email_confirmed_at:"confirmed"}},error:null});state.accept.mockResolvedValue("participant-id");
 state.redirect.mockImplementation((url:string)=>{throw Error("redirect:"+url);});
});
describe("invitation-only passwordless requests",()=>{
 it("uses the invited address, not a form override, and never sends an existing user's metadata",async()=>{
  const f=consent();f.set("email","attacker@example.test");
  expect(await sendTeamCodeAction({},f)).toMatchObject({phase:"waiting",authRequestAccepted:true});
  expect(state.resolve).toHaveBeenCalledExactlyOnceWith("resolve_team_invitation_auth",{p_token_hash:hash});
  expect(state.send).toHaveBeenCalledExactlyOnceWith({email,options:{shouldCreateUser:false,emailRedirectTo:"https://ai-diagnostic-staging-web.onrender.com/ru/team/confirm"}});
  expect(state.limit).toHaveBeenCalledTimes(4);expect(JSON.stringify(state.limit.mock.calls)).not.toContain(email);
  const stored=state.jar.get("team-email-challenge")!;expect(stored).not.toContain(email);expect(stored).not.toContain(token);
  expect(openTeamChallenge(stored,hash,secret)?.email).toBe(email);expect(state.set.mock.calls[0][2]).toMatchObject({httpOnly:true,secure:true,sameSite:"lax",path:"/ru/team",maxAge:600});
  expect(state.accept).not.toHaveBeenCalled();expect(state.jar.get("team-invitation")).toBeTruthy();
 });
 it("creates a passwordless identity with explicit versioned consent and no marketing for a new participant",async()=>{
  state.resolve.mockResolvedValue({data:{email,display_name:"Invited participant",create_user:true},error:null});
  expect((await sendTeamCodeAction({},consent())).authRequestAccepted).toBe(true);
  expect(state.send.mock.calls[0][0]).toEqual({email,options:{shouldCreateUser:true,emailRedirectTo:"https://ai-diagnostic-staging-web.onrender.com/ru/team/confirm",data:{full_name:"Invited participant",data_processing_consent:true,marketing_consent:false,data_processing_version:"v1",marketing_version:"v1"}}});
  expect(JSON.stringify(state.send.mock.calls)).not.toContain("password");
 });
 it.each(["missing","version"])("refuses %s consent before account creation or email",async(kind)=>{
  const f=consent();if(kind==="missing")f.delete("data_processing_consent");else f.set("data_processing_version","old");
  expect((await sendTeamCodeAction({},f)).error).toBeTruthy();expect(state.send).not.toHaveBeenCalled();expect(state.accept).not.toHaveBeenCalled();
 });
 it.each(["origin","disabled","cookie"])("rejects an invalid %s before resolver/email access",async(kind)=>{
  if(kind==="origin")state.origin="https://foreign.example.test";if(kind==="disabled")state.enabled=false;if(kind==="cookie")state.jar.clear();
  expect((await sendTeamCodeAction({},consent())).error).toBeTruthy();expect(state.resolve).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
 });
 it("refuses unavailable/revoked/closed invitations without leaking a database error",async()=>{
  state.resolve.mockResolvedValue({data:null,error:{message:"sensitive details"}});
  const result=await sendTeamCodeAction({},consent());expect(result.error).toContain("Приглашение недоступно");expect(result.error).not.toContain("sensitive");expect(state.send).not.toHaveBeenCalled();
 });
 it("enforces send limits and preserves the previous challenge on failed resend",async()=>{
  challenge();const old=state.jar.get("team-email-challenge");state.limit.mockRejectedValue(Error("rate_limited"));
  expect(await sendTeamCodeAction({phase:"waiting",authRequestAccepted:true},consent())).toMatchObject({phase:"error",authRequestAccepted:false,error:expect.stringContaining("Слишком много")});
  expect(state.send).not.toHaveBeenCalled();expect(state.jar.get("team-email-challenge")).toBe(old);
 });
 it("does not expose provider output or claim delivery when email submission fails",async()=>{
  state.send.mockResolvedValue({error:{status:500,message:"sensitive provider response"}});
  const result=await sendTeamCodeAction({},consent());expect(result.authRequestAccepted).not.toBe(true);expect(result.error).not.toContain("sensitive");expect(state.jar.has("team-email-challenge")).toBe(false);
 });
});
describe("email proof and invitation acceptance",()=>{
 it("verifies the server-bound email then uses the unchanged authenticated acceptance RPC",async()=>{
  challenge();const f=code();f.set("email","attacker@example.test");
  await expect(verifyTeamCodeAction({},f)).rejects.toThrow("redirect:/ru/team/responses/participant-id");
  expect(state.verify).toHaveBeenCalledExactlyOnceWith({email,token:"123456",type:"email"});
  expect(state.identity).toHaveBeenCalledOnce();expect(state.accept).toHaveBeenCalledExactlyOnceWith("accept_team_invitation",{p_token:token});
  expect(state.jar.get("team-email-challenge")).toBe("");expect(state.jar.get("team-invitation")).toBe("");
 });
 it.each(["absent","different_invitation","expired","malformed_code"])("rejects %s proof before touching authentication",async(kind)=>{
  challenge();if(kind==="absent")state.jar.delete("team-email-challenge");
  if(kind==="different_invitation")state.jar.set("team-invitation",sealInvitation("b".repeat(64),secret));
  if(kind==="expired")state.jar.set("team-email-challenge",sealTeamChallenge(email,hash,secret,1000));
  const result=await verifyTeamCodeAction({},code(kind==="malformed_code"?"123":"123456"));
  expect(result.error).toContain("Код неверен");expect(state.verify).not.toHaveBeenCalled();expect(state.accept).not.toHaveBeenCalled();
 });
 it("re-checks revocation/close before verifying the code",async()=>{
  challenge();state.resolve.mockResolvedValue({data:null,error:{message:"closed"}});
  expect((await verifyTeamCodeAction({},code())).error).toContain("Приглашение недоступно");expect(state.verify).not.toHaveBeenCalled();expect(state.accept).not.toHaveBeenCalled();
 });
 it.each(["error","no_session","wrong_email","unconfirmed"])("does not accept on %s",async(kind)=>{
  challenge();state.verify.mockResolvedValue({data:{session:kind==="no_session"?null:{},user:{email:kind==="wrong_email"?"other@example.test":email,email_confirmed_at:kind==="unconfirmed"?null:"confirmed"}},error:kind==="error"?{message:"private"}:null});
  expect((await verifyTeamCodeAction({},code())).error).toContain("Код неверен");expect(state.accept).not.toHaveBeenCalled();
 });
 it("preserves administrator assurance redirects instead of bypassing them for participants",async()=>{
  challenge();state.identity.mockRejectedValue(Error("redirect:/ru/mfa"));
  await expect(verifyTeamCodeAction({},code())).rejects.toThrow("redirect:/ru/mfa");expect(state.accept).not.toHaveBeenCalled();
 });
 it("does not grant a response if collection closes after email proof",async()=>{
  challenge();state.accept.mockRejectedValue(Error("team_invitation_unavailable"));
  expect((await verifyTeamCodeAction({},code())).error).toContain("Приглашение недоступно");expect(state.redirect).not.toHaveBeenCalled();expect(state.jar.get("team-invitation")).toBe("");
 });
});
describe("encrypted short-lived challenge",()=>{
 it("has independent random envelopes, rejects tamper/wrong key/binding/expiry, and never contains raw credentials",()=>{
  const a=sealTeamChallenge(email,hash,secret,1000),b=sealTeamChallenge(email,hash,secret,1000);expect(a).not.toBe(b);
  expect(openTeamChallenge(a,hash,secret,2000)?.email).toBe(email);expect(openTeamChallenge(a,"b".repeat(64),secret,2000)).toBeNull();
  expect(openTeamChallenge(a,hash,"wrong-secret",2000)).toBeNull();expect(openTeamChallenge(a,hash,secret,601000)).toBeNull();
  const bytes=Buffer.from(a,"base64url");bytes[30]^=1;expect(openTeamChallenge(bytes.toString("base64url"),hash,secret,2000)).toBeNull();
  expect(a).not.toContain(email);expect(a).not.toContain(token);for(const invalid of [undefined,"","x".repeat(1025),"!bad"])expect(openTeamChallenge(invalid,hash,secret,2000)).toBeNull();
 });
});

describe("Team primary email continuation and current session",()=>{
 it("accepts a matching confirmed session after consent without sending Auth email",async()=>{
  state.current.mockResolvedValue({user:{email,email_confirmed_at:"confirmed"}});
  await expect(sendTeamCodeAction({},consent())).rejects.toThrow("redirect:/ru/team/responses/participant-id");
  expect(state.send).not.toHaveBeenCalled();expect(state.verify).not.toHaveBeenCalled();expect(state.accept).toHaveBeenCalledOnce();
  expect(state.limit).toHaveBeenCalledWith("team-accept:participant-user",20,3600);
 });
 it("does not accept even matching verified email before personal consent",async()=>{
  state.current.mockResolvedValue({user:{email,email_confirmed_at:"confirmed"}});
  expect((await sendTeamCodeAction({},new FormData())).error).toContain("согласие");
  expect(state.send).not.toHaveBeenCalled();expect(state.accept).not.toHaveBeenCalled();
 });
 it.each(["send","code","link"])("denies a concurrent wrong session before %s credentials are used",async(kind)=>{
  challenge();state.current.mockResolvedValue({user:{email:"owner@example.test",email_confirmed_at:"confirmed"}});state.user.mockResolvedValue({data:{user:{email:"owner@example.test",email_confirmed_at:"confirmed"}},error:null});
  const f=code();f.set("token_hash","x".repeat(64));f.set("type","email");
  const result=await (kind==="send"?sendTeamCodeAction({},consent()):kind==="code"?verifyTeamCodeAction({},f):confirmTeamEmailAction({},f));
  expect(result.phase).toBe("wrong");expect(state.send).not.toHaveBeenCalled();expect(state.verify).not.toHaveBeenCalled();expect(state.accept).not.toHaveBeenCalled();
 });
 it("uses a Supabase-issued hash to verify and continues directly to the bound questionnaire",async()=>{
  challenge();const f=new FormData();f.set("token_hash","x".repeat(64));f.set("type","email");
  await expect(confirmTeamEmailAction({},f)).rejects.toThrow("redirect:/ru/team/responses/participant-id");
  expect(state.verify).toHaveBeenCalledExactlyOnceWith({token_hash:"x".repeat(64),type:"email"});
  expect(state.accept).toHaveBeenCalledExactlyOnceWith("accept_team_invitation",{p_token:token});
  expect(state.jar.get("team-invitation")).toBe("");expect(state.jar.get("team-email-challenge")).toBe("");
 });
 it("rejects a direct emailed Auth hash without the protected consent challenge",async()=>{
  const f=new FormData();f.set("token_hash","x".repeat(64));f.set("type","email");
  expect((await confirmTeamEmailAction({},f)).phase).toBe("expired");expect(state.verify).not.toHaveBeenCalled();
 });
 it("rejects expired context, clears cookies and replaces a previous sent state without requesting email",async()=>{
  state.jar.set("team-invitation",sealInvitation(token,secret,1000));challenge();
  const result=await sendTeamCodeAction({phase:"waiting",authRequestAccepted:true,sentAt:Date.now()},consent());
  expect(result).toMatchObject({phase:"expired",authRequestAccepted:false,error:expect.stringContaining("сессии приглашения истёк")});
  expect(result).not.toHaveProperty("sentAt");expect(state.send).not.toHaveBeenCalled();expect(state.resolve).not.toHaveBeenCalled();
  expect(state.jar.get("team-invitation")).toBe("");expect(state.jar.get("team-email-challenge")).toBe("");
 });
});
