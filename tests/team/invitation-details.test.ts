import {describe,it,expect,vi,afterEach} from "vitest";
import {sealInvitationDetails,openInvitationDetails,maskTeamEmail} from "@/server/team/invitation-details";
import {getTeamInvitationProvider,teamInvitationMessage} from "@/server/team/invitation-email";
const hash="a".repeat(64),secret="synthetic",value={email:"participant@example.test",company:"Company",team:"Team",inviter:"Owner",invitationHash:hash};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("authenticated display context",()=>{
 it("binds trusted company context to one invitation, rejects tamper, expiry and wrong key",()=>{
  const a=sealInvitationDetails(value,secret,1000),b=sealInvitationDetails(value,secret,1000);
  expect(a).not.toBe(b);expect(a).not.toContain(value.email);expect(a).not.toContain(value.company);
  expect(openInvitationDetails(a,hash,secret,1001)).toMatchObject(value);
  expect(openInvitationDetails(a,"b".repeat(64),secret,1001)).toBeNull();expect(openInvitationDetails(a,hash,"other",1001)).toBeNull();
  expect(openInvitationDetails(a,hash,secret,1000+7*86400000)).toBeNull();
  const bytes=Buffer.from(a,"base64url");bytes[35]^=1;expect(openInvitationDetails(bytes.toString("base64url"),hash,secret,1001)).toBeNull();
 });
 it("masks the local address and escapes owner-entered HTML",()=>{
  expect(maskTeamEmail(value.email)).toBe("p***@example.test");
  const mail=teamInvitationMessage({company:"<img src=x>",team:"<script>bad</script>",inviter:'Owner & "Name"',url:"https://staging.example.test/ru/team/join#invitation=synthetic&context=synthetic"});
  expect(mail.html).not.toContain("<script>");expect(mail.html).not.toContain("<img");expect(mail.html).toContain("&lt;script&gt;");expect(mail.html).toContain("Принять приглашение");expect(mail.text).toContain("индивидуальные ответы");
 });
 it("isolates Team provider mode, leaves unrelated mail mock and makes mock network-free",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);vi.stubEnv("EMAIL_PROVIDER","mock");vi.stubEnv("TEAM_INVITATION_EMAIL_PROVIDER","mock");
  const provider=getTeamInvitationProvider();await provider.send({to:value.email,subject:"Synthetic",text:"Synthetic",idempotencyKey:"synthetic"});
  expect(fetch).not.toHaveBeenCalled();expect(process.env.EMAIL_PROVIDER).toBe("mock");
  vi.stubEnv("TEAM_INVITATION_EMAIL_PROVIDER","resend");expect(getTeamInvitationProvider().name).toBe("resend");expect(process.env.EMAIL_PROVIDER).toBe("mock");
  vi.stubEnv("TEAM_INVITATION_EMAIL_PROVIDER","unsupported");expect(getTeamInvitationProvider).toThrow("team_email_provider_invalid");
 });
});
