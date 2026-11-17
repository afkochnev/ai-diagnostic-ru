import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ appUrl: vi.fn(), origin: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), clear: vi.fn(), jar: new Map<string, string>(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: m.origin }), cookies: async () => ({
  getAll: () => [], get: (name: string) => m.jar.has(name) ? { value: m.jar.get(name) } : undefined,
  set: (name: string, value: string) => m.jar.set(name, value),
}) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: m.appUrl(), AUTH_FLOW_SECRET: "local-auth-test-key", secure: true }) }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ auth: m, rpc: m.rpc }) }));
vi.mock("@/server/auth/recovery", () => ({ clearRecovery: m.clear, hasRecovery: vi.fn(), setRecovery: vi.fn() }));
import { confirmAction, emailLoginAction } from "@/server/auth/actions";
import { LEGACY_PUBLIC_APP_ORIGIN, PRODUCTION_SUPABASE_URL, PUBLIC_APP_ORIGIN } from "@/shared/app-origin";

function emailForm() { const form = new FormData(); form.set("email", "synthetic@example.test"); return form; }
function confirmation(type: string) { const form = new FormData(); form.set("type", type); form.set("token_hash", "a".repeat(64)); return form; }
beforeEach(() => {
  vi.clearAllMocks(); m.jar.clear(); m.rpc.mockResolvedValue({error: null}); m.origin.mockReturnValue("https://staging.example.test"); m.appUrl.mockReturnValue("https://staging.example.test");
  m.signInWithOtp.mockResolvedValue({ error: null });
  m.verifyOtp.mockResolvedValue({ data: { user: { id: "user" }, session: {} }, error: null });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

describe("email sign-in and confirmation continuation", () => {
  const teamPath = "/ru/team/responses/10000000-0000-4000-8000-000000000001";
  it("returns a verified participant to the questionnaire through the fixed email callback", async () => {
    const form = emailForm(); form.set("next", teamPath);
    await emailLoginAction({}, form);
    expect(m.signInWithOtp).toHaveBeenCalledWith({ email: "synthetic@example.test", options: { shouldCreateUser: false, emailRedirectTo: "https://staging.example.test/auth/confirm" } });
    expect(m.jar.get("team-login-return")).not.toContain("synthetic@example.test");
    m.verifyOtp.mockResolvedValueOnce({data: { user: { id: "participant", email: "synthetic@example.test" }, session: {} }, error: null});
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:" + teamPath);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("read_team_response", {p_participant_id: "10000000-0000-4000-8000-000000000001"});
    expect(m.jar.get("team-login-return")).toBe("");
  });
  it("does not use another email's continuation or grant questionnaire access to the wrong actor", async () => {
    const form = emailForm(); form.set("next", teamPath);
    await emailLoginAction({}, form);
    m.verifyOtp.mockResolvedValueOnce({data: {user: {id: "other", email: "other@example.test"}, session: {}}, error: null});
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:/ru/account");
    expect(m.rpc).not.toHaveBeenCalled();

    await emailLoginAction({}, form);
    m.verifyOtp.mockResolvedValueOnce({data: {user: {id: "participant", email: "synthetic@example.test"}, session: {}}, error: null});
    m.rpc.mockResolvedValueOnce({error: {message: "team_response_unavailable"}});
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:/ru/login?method=email&next=" + encodeURIComponent(teamPath));
  });
  it("returns a spent invitation's recipient to invitation continuation after email verification", async () => {
    const form = emailForm(); form.set("next", "team-invitation");
    await emailLoginAction({}, form);
    m.verifyOtp.mockResolvedValueOnce({data: {user: {id: "participant", email: "synthetic@example.test"}, session: {}}, error: null});
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:/ru/team/join");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("requests an existing-account link without creating users or accepting external redirects", async () => {
    const form = emailForm(); form.set("next", "https://foreign.example");
    expect((await emailLoginAction({}, form)).success).toBeTruthy();
    expect(m.signInWithOtp).toHaveBeenCalledWith({ email: "synthetic@example.test", options: { shouldCreateUser: false, emailRedirectTo: "https://staging.example.test/auth/confirm" } });
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
  it("finishes an existing same-host callback on the old origin while issuing new links only on .ru", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", PUBLIC_APP_ORIGIN);
    vi.stubEnv("SUPABASE_URL", PRODUCTION_SUPABASE_URL);
    m.appUrl.mockReturnValue(PUBLIC_APP_ORIGIN);
    m.origin.mockImplementation(name => ({ origin: LEGACY_PUBLIC_APP_ORIGIN, host: new URL(LEGACY_PUBLIC_APP_ORIGIN).host })[name as "origin" | "host"] ?? null);
    await expect(confirmAction({}, confirmation("email"))).rejects.toThrow("redirect:/ru/account");
    expect(m.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "a".repeat(64) });
    await expect(emailLoginAction({}, emailForm())).rejects.toThrow("Invalid action origin");

    m.origin.mockImplementation(name => ({ origin: PUBLIC_APP_ORIGIN, host: new URL(PUBLIC_APP_ORIGIN).host })[name as "origin" | "host"] ?? null);
    expect((await emailLoginAction({}, emailForm())).success).toBeTruthy();
    expect(m.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "synthetic@example.test",
      options: { shouldCreateUser: false, emailRedirectTo: PUBLIC_APP_ORIGIN + "/auth/confirm" },
    });
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
