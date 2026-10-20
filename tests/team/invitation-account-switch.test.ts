import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ origin: "https://ai-diagnostic-staging-web.onrender.com", jar: new Map<string, string>(), signOut: vi.fn(), rpc: vi.fn(), redirect: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: state.origin }), cookies: async () => ({ get: (n: string) => state.jar.has(n) ? { value: state.jar.get(n) } : undefined, set: (n: string, v: string) => state.jar.set(n, v), delete: (n: string) => state.jar.delete(n) }) }));
vi.mock("next/navigation", () => ({ redirect: state.redirect, useRouter:()=>({refresh:vi.fn()}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: state.createClient }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://ai-diagnostic-staging-web.onrender.com", AUTH_FLOW_SECRET: "synthetic-secret", secure: true }) }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: () => true }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "current-user", email_confirmed_at: "confirmed" } }) }));
vi.mock("@/server/account/authorization", () => ({ requireCompanyWrite: vi.fn() }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/team/service", () => ({ teamRpc: state.rpc, ownerTeam: vi.fn() }));
vi.mock("@/server/consultation/provider", () => ({ getConsultationProvider: vi.fn() }));
import { prepareTeamInvitationAction, switchTeamInvitationAccountAction } from "@/server/team/actions";
vi.mock("@/server/team/passwordless-actions",()=>({sendTeamCodeAction:vi.fn(),verifyTeamCodeAction:vi.fn()}));
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
    await prepareTeamInvitationAction({}, form); const pending = state.jar.get("team-invitation"); state.jar.set("auth-recovery", "old-recovery"); state.jar.set("team-invitation-auth", "synthetic-proof");
    await expect(switchTeamInvitationAccountAction()).rejects.toThrow("redirect:/ru/team/join");
    expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(state.jar.get("team-invitation")).toBe(pending); expect(state.jar.get("team-invitation-auth")).toBe("synthetic-proof"); expect(state.jar.has("auth-recovery")).toBe(false); expect(state.rpc).not.toHaveBeenCalled();
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
});
const ready={phase:"ready" as const,company:"Invited company",team:"Team title",inviter:"Inviter",maskedEmail:"a***@example.test",flowId:"flow",expires:Date.now()+1800000};
describe("invitation sign-in states",()=>{
 it("explains a wrong session with masked recipient and a safe logout action",()=>{
  const html=renderToStaticMarkup(createElement(TeamJoin,{view:{...ready,wrongAccount:true},policy}));
  expect(html).toContain("другого адреса");expect(html).toContain("a***@example.test");expect(html).toContain("Выйти и продолжить");
  expect(html).not.toContain("participant@example.test");expect(html).not.toContain("name=\"code\"");
 });
 it("offers context and consent before authentication without a password or code input",()=>{
  const html=renderToStaticMarkup(createElement(TeamJoin,{view:ready,policy}));
  for(const text of ["Invited company","Team title","Inviter","Продолжить","data_processing_consent"])expect(html).toContain(text);
  expect(html).not.toContain('name="code"');expect(html).not.toContain('type="password"');expect(html).not.toContain('checked=""');expect(html).not.toContain("/ru/login");
 });
 it("restores a valid waiting state with email CTA instructions and no numeric entry",()=>{
  const html=renderToStaticMarkup(createElement(TeamJoin,{view:{...ready,phase:"waiting",sentAt:Date.now(),codeExpires:Date.now()+600000},policy}));
  expect(html).toContain("Проверьте почту");expect(html).toContain("Нажмите кнопку в письме");expect(html).not.toContain("one-time-code");expect(html).not.toContain('name="code"');expect(html).not.toContain("одноразовый код");expect(html).not.toContain('checked=""');
 });
 it("expired context has no stale sent claim, resend action or code form",()=>{
  const html=renderToStaticMarkup(createElement(TeamJoin,{view:{phase:"expired"},policy}));
  expect(html).toContain("сессии приглашения истёк");expect(html).not.toContain("Письмо отправлено");expect(html).not.toContain('name="code"');expect(html).not.toContain("Отправить ещё раз");
 });
 it("an expired combined sign-in link requests organizer renewal rather than reopening the same expired proof",()=>{
  const html=renderToStaticMarkup(createElement(TeamJoin,{view:{phase:"expired",singleEmail:true},policy}));
  expect(html).toContain("Попросите организатора отправить новое приглашение");
  expect(html).not.toContain("Откройте письмо-приглашение снова");expect(html).not.toContain('name="code"');
 });
});
