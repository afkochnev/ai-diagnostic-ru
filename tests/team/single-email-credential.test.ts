import {beforeEach,describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
const state=vi.hoisted(()=>({reserve:vi.fn(),generate:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server-runtime/supabase/admin",()=>({createAdminClient:()=>({rpc:state.reserve,auth:{admin:{generateLink:state.generate}}})}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({APP_URL:"https://staging.example.test",AUTH_FLOW_SECRET:"synthetic-secret"})}));
import {singleEmailCredential} from "@/server/team/single-email";
import {sealInvitationAuthProof,openInvitationAuthProof,invitationAuthTtl} from "@/server/team/invitation-auth-proof";
const email="participant@example.test",hash="a".repeat(64),tokenHash="b".repeat(64),secret="synthetic-secret";
beforeEach(()=>{
 vi.clearAllMocks();state.reserve.mockResolvedValue({data:{email,display_name:"Participant",create_user:true},error:null});
 state.generate.mockResolvedValue({data:{properties:{hashed_token:tokenHash,verification_type:"invite"},user:{email}},error:null});
});
describe("one-email Supabase credential issuance",()=>{
 it("reserves a private nonce then requests a Supabase invite without fabricating consent",async()=>{
  const result=await singleEmailCredential(hash),request=state.generate.mock.calls[0][0];
  expect(request).toMatchObject({type:"invite",email,options:{redirectTo:"https://staging.example.test/ru/team/join"}});
  expect(request.options.data.team_pending_nonce).toMatch(/^[a-f0-9]{64}$/);
  expect(request.options.data).not.toHaveProperty("data_processing_consent");expect(request.options.data).not.toHaveProperty("password");
  expect(state.reserve).toHaveBeenCalledExactlyOnceWith("reserve_team_invitation_identity",{p_token_hash:hash,p_nonce_hash:createHash("sha256").update(request.options.data.team_pending_nonce).digest("hex")});
  expect(openInvitationAuthProof(result.envelope,hash,secret)).toMatchObject({email,tokenHash,type:"invite"});
  expect(result.envelope).not.toContain(tokenHash);expect(result.envelope).not.toContain(email);
 });
 it("existing-user link generation never changes metadata or password",async()=>{
  state.reserve.mockResolvedValue({data:{email,display_name:"Different display",create_user:false},error:null});
  state.generate.mockResolvedValue({data:{properties:{hashed_token:tokenHash,verification_type:"magiclink"},user:{email}},error:null});
  await singleEmailCredential(hash);
  expect(state.generate).toHaveBeenCalledExactlyOnceWith({type:"magiclink",email,options:{redirectTo:"https://staging.example.test/ru/team/join"}});
 });
 it("does not request an Auth credential for an unavailable reservation",async()=>{
  state.reserve.mockResolvedValue({data:null,error:{message:"private"}});
  await expect(singleEmailCredential(hash)).rejects.toThrow("team_invitation_unavailable");expect(state.generate).not.toHaveBeenCalled();
 });
 it.each(["failure","wrong_email","wrong_type"])("rejects %s without propagating credentials or provider diagnostics",async(kind)=>{
  state.generate.mockResolvedValue({data:{properties:{hashed_token:tokenHash,verification_type:kind==="wrong_type"?"recovery":"invite"},user:{email:kind==="wrong_email"?"other@example.test":email}},error:kind==="failure"?{message:"private"}:null});
  await expect(singleEmailCredential(hash)).rejects.toThrow("team_auth_unavailable");
 });
});
it("proof encryption enforces purpose, invitation binding, integrity, and original issue expiry",()=>{
 const value={email,invitationHash:hash,tokenHash,type:"invite" as const};
 const envelope=sealInvitationAuthProof(value,secret,1000);
 expect(openInvitationAuthProof(envelope,hash,secret,2000)).toMatchObject(value);
 expect(openInvitationAuthProof(envelope,"c".repeat(64),secret,2000)).toBeNull();
 expect(openInvitationAuthProof(envelope,hash,"other-secret",2000)).toBeNull();
 expect(openInvitationAuthProof(envelope,hash,secret,1000+invitationAuthTtl)).toBeNull();
 const bytes=Buffer.from(envelope,"base64url");bytes[30]^=1;
 expect(openInvitationAuthProof(bytes.toString("base64url"),hash,secret,2000)).toBeNull();
});
