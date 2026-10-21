import { afterEach, describe, expect, it, vi } from "vitest";
import { teamCreation, teamInvitation, teamSave } from "@/server/team/contracts";
import { sealInvitation, openInvitation } from "@/server/team/invitation-envelope";
import { teamFoundationEnabled } from "@/server/team/capabilities";
const id = "10000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllEnvs());
describe("team invitation and answer contracts", () => {
  it("validates company scope, display name, email and bounded confidential answers", () => {
    expect(teamCreation.safeParse({companyId:id,title:"Team"}).success).toBe(true);
    expect(teamInvitation.parse({teamId:id,email:"owner@example.test",displayName:" Participant "}).displayName).toBe("Participant");
    expect(teamInvitation.safeParse({teamId:id,email:"one@example.test,two@example.test",displayName:"Participant"}).success).toBe(false);
    for (const val of [0,4,"Private text",null]) expect(teamSave.safeParse({participantId:id,revision:0,answers:{[id]:val},submit:false}).success).toBe(true);
    for (const val of [-1,5,2.5,{},"x".repeat(10001)]) expect(teamSave.safeParse({participantId:id,revision:0,answers:{[id]:val},submit:true}).success).toBe(false);
  });
  it("encrypts invitation secrets with random IV and explicit expiry", () => {
    const token="a".repeat(64), secret="synthetic-secret";
    const a=sealInvitation(token,secret,1000), b=sealInvitation(token,secret,1000);
    expect(a).not.toBe(b); expect(a).not.toContain(token);
    expect(openInvitation(a,secret,2000)).toBe(token);
    expect(openInvitation(a,secret,1801000)).toBeNull();
    expect(openInvitation(a,"another-secret",2000)).toBeNull();
    const changed=Buffer.from(a,"base64url"); changed[30]^=1;
    expect(openInvitation(changed.toString("base64url"),secret,2000)).toBeNull();
    for (const bad of [undefined,"","invalid!","x".repeat(513)]) expect(openInvitation(bad,secret,2000)).toBeNull();
  });
  it("enables this foundation only for the exact staging application and database pair", () => {
    vi.stubEnv("APP_URL","https://ai-diagnostic-staging-web.onrender.com");
    vi.stubEnv("SUPABASE_URL","https://vflgxgdwlftlyjslyrmo.supabase.co");
    expect(teamFoundationEnabled()).toBe(true);
    vi.stubEnv("APP_URL","https://audit.iteam.ru"); expect(teamFoundationEnabled()).toBe(false);
    vi.stubEnv("APP_URL","https://ai-diagnostic-staging-web.onrender.com");
    vi.stubEnv("SUPABASE_URL","https://foreign.supabase.co"); expect(teamFoundationEnabled()).toBe(false);
  });
  it("allows explicit isolated loopback acceptance but never broadens production", () => {
    vi.stubEnv("APP_URL","http://127.0.0.1:3250");vi.stubEnv("SUPABASE_URL","http://127.0.0.1:55321");
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("TEAM_LOCAL_ACCEPTANCE",undefined);
    expect(teamFoundationEnabled()).toBe(false);
    vi.stubEnv("TEAM_LOCAL_ACCEPTANCE","1");expect(teamFoundationEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV","production");expect(teamFoundationEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("SUPABASE_URL","https://foreign.supabase.co");expect(teamFoundationEnabled()).toBe(false);
  });
});
