import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ origin: "https://ai-diagnostic-staging-web.onrender.com", jar: new Map<string, string>(), signOut: vi.fn(), rpc: vi.fn(), redirect: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: state.origin }), cookies: async () => ({ get: (n: string) => state.jar.has(n) ? { value: state.jar.get(n) } : undefined, set: (n: string, v: string) => state.jar.set(n, v), delete: (n: string) => state.jar.delete(n) }) }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: state.createClient }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://ai-diagnostic-staging-web.onrender.com", AUTH_FLOW_SECRET: "synthetic-secret", secure: true }) }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: () => true }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "current-user", email_confirmed_at: "confirmed" } }) }));
vi.mock("@/server/account/authorization", () => ({ requireCompanyWrite: vi.fn() }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/team/service", () => ({ teamRpc: state.rpc, ownerTeam: vi.fn() }));
vi.mock("@/server/consultation/provider", () => ({ getConsultationProvider: vi.fn() }));
import { acceptTeamInvitationAction, prepareTeamInvitationAction, switchTeamInvitationAccountAction } from "@/server/team/actions";
import { TeamJoin } from "@/features/team/join";
const policy={versions:{data_processing:"v1",marketing:"v1"},temporary:false,dataUrl:"/ru/legal/data-processing",marketingUrl:"/ru/legal/marketing"};
beforeEach(() => {
  vi.clearAllMocks(); state.jar.clear(); state.origin = "https://ai-diagnostic-staging-web.onrender.com";
  state.signOut.mockResolvedValue({ error: null }); state.createClient.mockResolvedValue({ auth: { signOut: state.signOut } });
  state.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});
describe("invitation account change", () => {
  it("preserves the encrypted invitation across a local sign-out until the new actor accepts", async () => {
    const form = new FormData(); form.set("token", "a".repeat(64));
    await prepareTeamInvitationAction({}, form); const pending = state.jar.get("team-invitation"); state.jar.set("auth-recovery", "old-recovery");
    await expect(switchTeamInvitationAccountAction()).rejects.toThrow("redirect:/ru/team/join");
    expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(state.jar.get("team-invitation")).toBe(pending); expect(state.jar.has("auth-recovery")).toBe(false); expect(state.rpc).not.toHaveBeenCalled();
    state.rpc.mockResolvedValue("participant-id");
    await expect(acceptTeamInvitationAction()).rejects.toThrow("redirect:/ru/team/responses/participant-id");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("accept_team_invitation", { p_token: "a".repeat(64) });
    expect(state.jar.get("team-invitation")).toBe("");
  });
  it("rejects a foreign origin before touching the session or invitation", async () => {
    state.origin = "https://foreign.example.test"; state.jar.set("team-invitation", "pending");
    expect((await switchTeamInvitationAccountAction()).error).toBeTruthy();
    expect(state.createClient).not.toHaveBeenCalled(); expect(state.jar.get("team-invitation")).toBe("pending"); expect(state.redirect).not.toHaveBeenCalled();
  });
  it("retains the invitation and displays a safe error when sign-out fails", async () => {
    state.jar.set("team-invitation", "pending"); state.signOut.mockResolvedValue({ error: { message: "private auth detail" } });
    const result = await switchTeamInvitationAccountAction();
    expect(result.error).toContain("Не удалось выйти"); expect(result.error).not.toContain("private"); expect(state.jar.get("team-invitation")).toBe("pending"); expect(state.redirect).not.toHaveBeenCalled();
  });
  it("explains an unavailable invitation without exposing the intended recipient", async () => {
    const form = new FormData(); form.set("token", "a".repeat(64)); await prepareTeamInvitationAction({}, form);
    state.rpc.mockRejectedValue(new Error("team_invitation_unavailable"));
    const result = await acceptTeamInvitationAction();
    expect(result.error).toContain("email текущего аккаунта"); expect(state.jar.get("team-invitation")).toBeTruthy(); expect(state.redirect).not.toHaveBeenCalled();
  });
});
describe("invitation sign-in states", () => {
  it("shows the current account and an account-change action before acceptance", () => {
    const html = renderToStaticMarkup(createElement(TeamJoin, { currentEmail: "owner@example.test", emailConfirmed: true, hasPending: true, policy }));
    expect(html).toContain("owner@example.test"); expect(html).toContain("Войти под другим email"); expect(html).toContain("Принять приглашение");
  });
  it("gives unconfirmed users a confirmation path instead of the already-signed-in login loop", () => {
    const html = renderToStaticMarkup(createElement(TeamJoin, { currentEmail: "participant@example.test", emailConfirmed: false, hasPending: true, policy }));
    expect(html).toContain("Получить код на email"); expect(html).toContain("Войти под другим email"); expect(html).not.toContain("Войти для участия"); expect(html).not.toContain("Принять приглашение");
  });
  it("offers passwordless entry to anonymous participants without the old registration detour", () => {
    const html = renderToStaticMarkup(createElement(TeamJoin, { currentEmail: null, emailConfirmed: false, hasPending: true, policy }));
    expect(html).toContain("Получить код на email"); expect(html).not.toContain("/ru/login"); expect(html).not.toContain("type=\"password\""); expect(html).not.toContain("Вы вошли как"); expect(html).not.toContain("Принять приглашение");
  });
  it("restores code entry after a reload with a pending challenge and keeps consent unchecked", () => {
    const html = renderToStaticMarkup(createElement(TeamJoin, { currentEmail: null, emailConfirmed: false, hasPending: true, policy, pendingCode: true }));
    expect(html).toContain("Войти и открыть анкету"); expect(html).toContain('autoComplete="one-time-code"');
    expect(html).not.toContain('checked=""'); expect(html).not.toContain('type="password"');
  });
});
