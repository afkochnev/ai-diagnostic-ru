import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),credential:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server-runtime/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({AUTH_FLOW_SECRET:"synthetic-secret"})}));
vi.mock("@/server/team/single-email",()=>({singleEmailCredential:mocks.credential}));
import {issueInvitationDayAccess,claimInvitationDayAccess} from "@/server/team/day-access";
import {openInvitationAuthProof,sealInvitationAuthProof,sealInvitationDayGrant,type InvitationDayGrant} from "@/server/team/invitation-auth-proof";
const hash="a".repeat(64),email="participant@example.test",secret="synthetic-secret";
const grant=():InvitationDayGrant=>({version:2,purpose:"team-invitation-day",email,invitationHash:hash,expires:Date.now()+86400000});
beforeEach(()=>{vi.clearAllMocks();mocks.credential.mockResolvedValue({email,envelope:"private-fresh-credential"});});
describe("24-hour invitation grant",()=>{
 it("uses the database deadline and encrypts only scoped authorization, without minting Supabase credentials at email issuance",async()=>{
  const expires=Date.now()+86400000;
  mocks.rpc.mockResolvedValue({data:{status:"issued",email,expires_at:new Date(expires).toISOString()},error:null});
  const result=await issueInvitationDayAccess(hash,email);
  expect(openInvitationAuthProof(result.envelope,hash,secret)).toEqual({...grant(),expires});
  expect(result.envelope).not.toContain(email);expect(mocks.credential).not.toHaveBeenCalled();
  const shorter=expires-3600000;mocks.rpc.mockResolvedValue({data:{status:"issued",email,expires_at:new Date(shorter).toISOString()},error:null});
  expect((await issueInvitationDayAccess(hash,email)).expires).toBe(shorter);
 });
 it("rejects tampering, another invitation, an expired day grant, and preserves legacy 30-minute proofs",()=>{
  const value={...grant(),expires:1000+86400000},encoded=sealInvitationDayGrant(value,secret);
  expect(openInvitationAuthProof(encoded,hash,secret,1000+86399000)).toEqual(value);
  expect(openInvitationAuthProof(encoded,hash,secret,1000+86400000)).toBeNull();
  expect(openInvitationAuthProof(encoded,"b".repeat(64),secret,2000)).toBeNull();
  expect(openInvitationAuthProof(encoded,hash,"wrong-secret",2000)).toBeNull();
  const bytes=Buffer.from(encoded,"base64url");bytes[20]^=1;expect(openInvitationAuthProof(bytes.toString("base64url"),hash,secret,2000)).toBeNull();
  const legacy=sealInvitationAuthProof({email,invitationHash:hash,tokenHash:"c".repeat(64),type:"invite"},secret,1000);
  expect(openInvitationAuthProof(legacy,hash,secret,2000)).toHaveProperty("tokenHash");
  expect(openInvitationAuthProof(legacy,hash,secret,1000+1800000)).toBeNull();
 });
 it.each(["busy","spent","rate_limited"])("does not mint another credential for %s",async status=>{
  mocks.rpc.mockResolvedValue({data:{status},error:null});
  await expect(claimInvitationDayAccess(grant(),fetch)).rejects.toThrow();expect(mocks.credential).not.toHaveBeenCalled();
 });
 it("checks the authoritative recipient and deadline before fresh Auth issuance",async()=>{
  const value=grant();
  mocks.rpc.mockResolvedValue({data:{status:"claimed",email:"wrong@example.test",expires_at:new Date(value.expires).toISOString(),lease_until:new Date(Date.now()+120000).toISOString()},error:null});
  await expect(claimInvitationDayAccess(value,fetch)).rejects.toThrow("team_invitation_unavailable");expect(mocks.credential).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({data:{status:"claimed",email,expires_at:new Date(value.expires).toISOString(),lease_until:new Date(Date.now()+120000).toISOString()},error:null});
  expect(await claimInvitationDayAccess(value,fetch)).toHaveProperty("envelope","private-fresh-credential");
  expect(mocks.credential).toHaveBeenCalledExactlyOnceWith(hash,fetch);
 });
 it("reports transient mint failure as a retriable error, without exposing provider text",async()=>{
  const value=grant();mocks.rpc.mockResolvedValue({data:{status:"claimed",email,expires_at:new Date(value.expires).toISOString(),lease_until:new Date(Date.now()+120000).toISOString()},error:null});
  mocks.credential.mockRejectedValue(Error("private provider details"));
  await expect(claimInvitationDayAccess(value,fetch)).rejects.toThrow("team_auth_retry");
 });
});
