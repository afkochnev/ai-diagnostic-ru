import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ origin: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), clear: vi.fn() }));
vi.mock("@/server/locale", () => ({ formLocale: (form?: FormData) => form?.get("locale") === "en" ? "en" : "ru", requestLocale: async () => "ru", rememberLocale: async () => {} }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: m.origin }), cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://staging.example.test" }) }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ auth: m, from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }) }));
vi.mock("@/server/auth/recovery", () => ({ clearRecovery: m.clear, hasRecovery: vi.fn(), setRecovery: vi.fn() }));
import { confirmAction, emailLoginAction } from "@/server/auth/actions";

function emailForm() { const form = new FormData(); form.set("email", "synthetic@example.test"); return form; }
function confirmation(type: string) { const form = new FormData(); form.set("type", type); form.set("token_hash", "a".repeat(64)); return form; }
beforeEach(() => {
  vi.clearAllMocks(); m.origin.mockReturnValue("https://staging.example.test");
  m.signInWithOtp.mockResolvedValue({ error: null });
  m.verifyOtp.mockResolvedValue({ data: { user: { id: "user" }, session: {} }, error: null });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("email sign-in and confirmation continuation", () => {
  it("preserves English through sign-in mail and a verified callback", async () => {
    const form = emailForm(); form.set("locale", "en");
    expect((await emailLoginAction({}, form)).success).toContain("If this email is registered");
    expect(m.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({options:{shouldCreateUser:false,emailRedirectTo:"https://staging.example.test/auth/confirm?locale=en"}}));
    const callback=confirmation("email"); callback.set("locale","en");
    await expect(confirmAction({}, callback)).rejects.toThrow("redirect:/en/account");
  });
  it("requests an existing-account link without creating users or accepting external redirects", async () => {
    const form = emailForm(); form.set("next", "https://foreign.example");
    expect((await emailLoginAction({}, form)).success).toBeTruthy();
    expect(m.signInWithOtp).toHaveBeenCalledWith({ email: "synthetic@example.test", options: { shouldCreateUser: false, emailRedirectTo: "https://staging.example.test/auth/confirm?locale=ru" } });
  });
  it("does not reveal whether the email exists, but reports actual technical failure", async () => {
    const existing = await emailLoginAction({}, emailForm());
    m.signInWithOtp.mockResolvedValue({ error: { code: "otp_disabled", status: 422 } });
    expect(await emailLoginAction({}, emailForm())).toEqual(existing);
    m.signInWithOtp.mockResolvedValue({ error: { code: "unexpected_failure", status: 503, message: "private provider body" } });
    const failed = await emailLoginAction({}, emailForm()); expect(failed.error).toBeTruthy(); expect(JSON.stringify(failed)).not.toContain("private");
  });
  it("enforces the action origin before sending mail", async () => {
    m.origin.mockReturnValue("https://foreign.example");
    await expect(emailLoginAction({}, emailForm())).rejects.toThrow("Invalid action origin");
    expect(m.signInWithOtp).not.toHaveBeenCalled();
  });
  it("shows signup success and routes email return directly into the workspace", async () => {
    await expect(confirmAction({}, confirmation("signup"))).rejects.toThrow("redirect:/ru/verification-complete");
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:/ru/account");
    expect(m.clear).toHaveBeenCalledTimes(2);
  });
  it("never continues an invalid email link", async () => {
    m.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "otp_expired" } });
    expect(await confirmAction({}, confirmation("email"))).toMatchObject({ error: expect.any(String), code: "invalid_link" }); expect(m.clear).not.toHaveBeenCalled();
  });
  it.each([{ code: "unexpected_failure", status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }])("allows retrying temporary provider failures without labeling the token invalid: %j", async (error) => {
    m.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error });
    const result = await confirmAction({}, confirmation("email"));
    expect(result.error).toBeTruthy();
    expect(result.code).toBeUndefined();
    expect(m.clear).not.toHaveBeenCalled();
  });
});
