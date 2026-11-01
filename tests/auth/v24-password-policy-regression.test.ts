import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  origin: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(), signOut: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(),
  documents: vi.fn(), recovery: vi.fn(), clear: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: m.origin }), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error("redirect:" + path); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://staging.example.test" }) }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({
  auth: m, from: () => ({ select: m.documents }),
}) }));
vi.mock("@/server/auth/recovery", () => ({ clearRecovery: m.clear, hasRecovery: m.recovery, setRecovery: vi.fn() }));
import { forgotAction, loginAction, registerAction, resetAction } from "@/server/auth/actions";

const password = "Synthetic-only-password-24!";
function registration() {
  const f = new FormData();
  for (const [k, v] of Object.entries({ full_name: "V24 synthetic user", email: "synthetic@example.test", password, confirm_password: password,
    data_processing_consent: "on", data_processing_version: "temporary-ru-v1", marketing_version: "temporary-ru-v1" })) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks(); m.origin.mockReturnValue("https://staging.example.test");
  m.documents.mockResolvedValue({ data: [{ kind: "data_processing", version: "temporary-ru-v1" }, { kind: "marketing", version: "temporary-ru-v1" }], error: null });
  m.signUp.mockResolvedValue({ data: { user: { identities: [{ provider: "email" }] } }, error: null });
  m.signInWithPassword.mockResolvedValue({ error: null });
  m.resetPasswordForEmail.mockResolvedValue({ error: null }); m.updateUser.mockResolvedValue({ error: null });
  m.signOut.mockResolvedValue({ error: null }); m.getUser.mockResolvedValue({ data: { user: { id: "synthetic-user" } } });
  m.getClaims.mockResolvedValue({ data: { claims: { session_id: "synthetic-session" } } }); m.recovery.mockResolvedValue(true);
});
describe("V24 password-policy regression without live Auth writes or mail", () => {
  it("keeps normal registration consent versions and confirmation redirect", async () => {
    await expect(registerAction({}, registration())).rejects.toThrow("redirect:/ru/verify-email");
    expect(m.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: {
      emailRedirectTo: "https://staging.example.test/auth/confirm", data: {
        full_name: "V24 synthetic user", data_processing_consent: true, marketing_consent: false,
        data_processing_version: "temporary-ru-v1", marketing_version: "temporary-ru-v1",
      },
    } }));
  });
  it.each(["consent", "version"])("blocks stale or missing %s before signup", async (kind) => {
    const f = registration(); if (kind === "consent") f.delete("data_processing_consent"); else f.set("data_processing_version", "old");
    expect(await registerAction({}, f)).toHaveProperty("error"); expect(m.signUp).not.toHaveBeenCalled();
  });
  it("does not treat the Auth weak-password rejection as registration success or expose its body", async () => {
    m.signUp.mockResolvedValue({ data: null, error: { status: 422, code: "weak_password", message: "private provider body" } });
    const result = await registerAction({}, registration());
    expect(result.error).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("private"); expect(m.clear).not.toHaveBeenCalled();
  });
  it("preserves existing password login and rejects unconfirmed login", async () => {
    await expect(loginAction({}, registration())).rejects.toThrow("redirect:/ru/account");
    m.signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed" } });
    expect((await loginAction({}, registration())).error).toContain("email");
  });
  it("keeps the recovery redirect and returns the same safe acknowledgment", async () => {
    expect((await forgotAction({}, registration())).success).toContain("Если этот email зарегистрирован");
    expect(m.resetPasswordForEmail).toHaveBeenCalledWith("synthetic@example.test", { redirectTo: "https://staging.example.test/auth/confirm?type=recovery" });
  });
  it("explains a current-password match without clearing the verified recovery session", async () => {
    m.updateUser.mockResolvedValue({error: {code: "same_password", status: 422, message: "private provider body"}});
    const result = await resetAction({}, registration());
    expect(result).toEqual({error: "Новый пароль совпадает с текущим. Введите другой пароль."});
    expect(m.clear).not.toHaveBeenCalled();expect(m.signOut).not.toHaveBeenCalled();
  });
  it("requires a recovery session bound to the current identity before password mutation", async () => {
    m.recovery.mockResolvedValue(false);
    expect((await resetAction({}, registration())).error).toBeTruthy(); expect(m.updateUser).not.toHaveBeenCalled();
    expect(m.recovery).toHaveBeenCalledWith("synthetic-user", "synthetic-session");
  });
  it("preserves password-reset logout and does not acknowledge a rejected new password", async () => {
    m.updateUser.mockResolvedValueOnce({ error: { status: 422, code: "weak_password" } });
    expect((await resetAction({}, registration())).error).toBeTruthy(); expect(m.signOut).not.toHaveBeenCalled();
    await expect(resetAction({}, registration())).rejects.toThrow("redirect:/ru/login?password=updated");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("rejects a foreign action origin before sending credentials or a recovery request", async () => {
    m.origin.mockReturnValue("https://foreign.example.test");
    await expect(forgotAction({}, registration())).rejects.toThrow("Invalid action origin");
    expect(m.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
