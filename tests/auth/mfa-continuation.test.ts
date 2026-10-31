import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({identity: vi.fn(), user: vi.fn(), role: vi.fn(), factors: vi.fn(), verify: vi.fn(), origin: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("react", async original => ({...await original<typeof import("react")>(), useActionState: () => [{}, vi.fn(), false]}));
vi.mock("next/navigation", () => ({redirect: (path: string) => {throw Error(`redirect:${path}`);}}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
vi.mock("next/headers", () => ({headers: async () => ({get: mocks.origin}), cookies: vi.fn()}));
vi.mock("@/server/supabase/config", () => ({authConfig: () => ({APP_URL: "https://audit.example.test"})}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: async () => ({
  auth: {getUser: mocks.user, mfa: {listFactors: mocks.factors, challengeAndVerify: mocks.verify}},
  from: () => ({select: () => ({eq: () => ({single: mocks.role})})}),
})}));
vi.mock("@/server/auth/session", () => ({getIdentity: mocks.identity}));
import MfaPage from "@/app/[locale]/(auth)/mfa/page";
import {verifyMfaAction} from "@/server/auth/actions";
import {safeMfaReturnTo} from "@/server/auth/mfa-return";

const next = "/ru/account/plan?account=10000000-0000-4000-8000-000000000001&company=20000000-0000-4000-8000-000000000001";
function form(returnTo = next) {
  const f = new FormData();
  f.set("factor_id", "own-factor"); f.set("code", "123456"); f.set("next", returnTo);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({user: {id: "admin", email_confirmed_at: "2026-10-31"}, role: "administrator", aal: "aal1", nextAal: "aal2"});
  mocks.user.mockResolvedValue({data: {user: {id: "admin", email_confirmed_at: "2026-10-31"}}});
  mocks.role.mockResolvedValue({data: {role: "administrator"}});
  mocks.factors.mockResolvedValue({data: {totp: [{id: "own-factor", status: "verified"}], all: [{id: "own-factor", factor_type: "totp", status: "verified"}]}});
  mocks.verify.mockResolvedValue({error: null});
  mocks.origin.mockReturnValue("https://audit.example.test");
});

describe("MFA continuation to Advanced", () => {
  it("explains existing account protection and transports the same plan context through the form", async () => {
    const html = renderToStaticMarkup(await MfaPage({searchParams: Promise.resolve({next})}));
    expect(html).toContain("В вашем аккаунте уже настроена двухфакторная защита");
    expect(html).toContain("После подтверждения вернём вас к подключению Advanced");
    expect(html).toContain('name="next"');
    expect(html).toContain(next.replaceAll("&", "&amp;"));
    expect(html).toContain('name="factor_id"');
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("returns to that plan only after Supabase verifies the user's own factor", async () => {
    await expect(verifyMfaAction({}, form())).rejects.toThrow(`redirect:${next}`);
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({factorId: "own-factor", code: "123456"});
  });

  it("keeps the MFA challenge and role/session checks on invalid codes, foreign factors and expired sessions", async () => {
    mocks.verify.mockResolvedValue({error: {message: "private provider error"}});
    expect(await verifyMfaAction({}, form())).toHaveProperty("error");
    mocks.verify.mockClear();
    const foreign = form(); foreign.set("factor_id", "foreign-factor");
    expect(await verifyMfaAction({}, foreign)).toHaveProperty("error");
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.role.mockResolvedValue({data: {role: "user"}});
    expect(await verifyMfaAction({}, form())).toHaveProperty("error");
    mocks.user.mockResolvedValue({data: {user: null}});
    expect(await verifyMfaAction({}, form())).toHaveProperty("error");
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("rejects a foreign action Origin before attempting verification", async () => {
    mocks.origin.mockReturnValue("https://foreign.example.test");
    await expect(verifyMfaAction({}, form())).rejects.toThrow("Invalid action origin");
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each(["https://foreign.example.test", "//foreign.example.test", "/\\foreign.example.test", "/ru/admin", next + "&code=ITEAM-SECRET", next + "&account=10000000-0000-4000-8000-000000000002", next + "#code=secret", "/ru/account/plan?account=foreign"])("ignores unsafe or unexpected return intent: %s", async unsafe => {
    expect(safeMfaReturnTo(unsafe)).toBeNull();
    await expect(verifyMfaAction({}, form(unsafe))).rejects.toThrow("redirect:/ru/admin");
    expect(mocks.verify).toHaveBeenCalledOnce();
  });

  it("uses the same safe destination if MFA was already verified, without another challenge", async () => {
    mocks.identity.mockResolvedValue({user: {id: "admin", email_confirmed_at: "2026-10-31"}, role: "administrator", aal: "aal2"});
    await expect(MfaPage({searchParams: Promise.resolve({next})})).rejects.toThrow(`redirect:${next}`);
    expect(mocks.factors).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
