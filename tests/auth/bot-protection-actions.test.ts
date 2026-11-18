import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  config: { enabled: true, configured: true, siteKey: "public-widget-key" as string | null },
  signUp: vi.fn(), signInWithPassword: vi.fn(), signInWithOtp: vi.fn(), resend: vi.fn(), resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(), limit: vi.fn(), honeypot: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://staging.example.test" }), cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error("redirect:" + path); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server-runtime/auth-captcha", () => ({ authCaptchaConfig: () => m.config }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://staging.example.test" }) }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({
  auth: m, from: () => ({ select: async () => ({ data: [{ kind: "data_processing", version: "v1" }, { kind: "marketing", version: "v1" }], error: null }) }),
}) }));
vi.mock("@/server/auth/abuse-limits", () => ({ enforceRegistrationLimits: m.limit, isRegistrationHoneypotFilled: m.honeypot }));
vi.mock("@/server/auth/recovery", () => ({ clearRecovery: vi.fn() }));
vi.mock("@/server/auth/team-login-return", () => ({ setTeamLoginReturn: vi.fn(), consumeTeamLoginReturn: async () => null, authorizedTeamReturn: vi.fn() }));
import { confirmAction, emailLoginAction, forgotAction, loginAction, registerAction, resendAction } from "@/server/auth/actions";
import { RateLimitExceeded } from "@/server/rate-limit";

function form(token: string | null = "single-use-token") {
  const f = new FormData();
  for (const [key, value] of Object.entries({ full_name: "Тестовый участник", email: "synthetic@example.test", password: "Synthetic-only-password!", confirm_password: "Synthetic-only-password!", data_processing_consent: "on", data_processing_version: "v1", marketing_version: "v1" })) f.set(key, value);
  if (token !== null) f.set("auth_captcha_token", token);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks(); m.config = { enabled: true, configured: true, siteKey: "public-widget-key" };
  m.limit.mockResolvedValue(undefined); m.honeypot.mockReturnValue(false);
  m.signUp.mockResolvedValue({ data: { user: { identities: [{ provider: "email" }] } }, error: null });
  for (const fn of [m.signInWithPassword, m.signInWithOtp, m.resend, m.resetPasswordForEmail]) fn.mockResolvedValue({ error: null });
});
describe("auth bot protection", () => {
  it.each([registerAction, loginAction, emailLoginAction, forgotAction, resendAction])("rejects a missing token before any protected provider call", async action => {
    expect((await action({}, form(null))).error).toContain("проверки защиты");
    for (const fn of [m.signUp, m.signInWithPassword, m.signInWithOtp, m.resend, m.resetPasswordForEmail]) expect(fn).not.toHaveBeenCalled();
  });
  it("fails closed if protection is enabled without a configured public key", async () => {
    m.config.configured = false; m.config.siteKey = null;
    expect((await registerAction({}, form())).error).toContain("временно недоступна");
    expect(m.signUp).not.toHaveBeenCalled();
  });
  it("passes the token to Supabase for signup and password login", async () => {
    await expect(registerAction({}, form())).rejects.toThrow("redirect:/ru/verify-email");
    expect(m.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ captchaToken: "single-use-token" }) }));
    await expect(loginAction({}, form())).rejects.toThrow("redirect:/ru/account");
    expect(m.signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ options: { captchaToken: "single-use-token" } }));
  });
  it("protects email sign-in, recovery and resend without changing their destinations", async () => {
    await emailLoginAction({}, form()); await forgotAction({}, form()); await resendAction({}, form());
    expect(m.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ captchaToken: "single-use-token", shouldCreateUser: false }) }));
    expect(m.resetPasswordForEmail).toHaveBeenCalledWith("synthetic@example.test", { captchaToken: "single-use-token", redirectTo: "https://staging.example.test/auth/confirm?type=recovery" });
    expect(m.resend).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ captchaToken: "single-use-token" }) }));
  });
  it("stops signup before user creation when the limiter refuses or is unavailable", async () => {
    m.limit.mockRejectedValueOnce(new RateLimitExceeded(60));
    expect((await registerAction({}, form())).error).toContain("Слишком много");
    m.limit.mockRejectedValueOnce(Error("private provider information"));
    const result = await registerAction({}, form());
    expect(result.error).toBeTruthy(); expect(JSON.stringify(result)).not.toContain("private"); expect(m.signUp).not.toHaveBeenCalled();
  });
  it("rejects a filled honeypot before signup or rate-limit consumption", async () => {
    m.honeypot.mockReturnValue(true);
    expect((await registerAction({}, form())).error).toBeTruthy();
    expect(m.limit).not.toHaveBeenCalled(); expect(m.signUp).not.toHaveBeenCalled();
  });
  it("returns a safe actionable error for invalid or replayed provider tokens", async () => {
    m.signInWithPassword.mockResolvedValue({ error: { code: "captcha_failed", message: "private provider information" } });
    expect((await loginAction({}, form())).error).toContain("Повторите");
  });
  it("keeps email-link confirmation usable without asking for another challenge", async () => {
    m.verifyOtp.mockResolvedValue({ data: { user: { id: "synthetic-user", email: "synthetic@example.test" }, session: {} }, error: null });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const f = new FormData(); f.set("type", "email"); f.set("token_hash", "a".repeat(64));
    await expect(confirmAction({}, f)).rejects.toThrow("redirect:/ru/account");
    expect(m.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "a".repeat(64) });
  });
});
