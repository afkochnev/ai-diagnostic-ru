import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ accounts: [{ id: "account-a", name: "Аккаунт A" }], plan: "Free", read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(`redirect:${p}`); } }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => state.accounts }));
vi.mock("@/server/entitlements", () => ({ getAccountPlan: state.read }));
import AccountPlanPage from "@/app/[locale]/(workspace)/account/plan/page";
beforeEach(() => {
  state.accounts = [{ id: "account-a", name: "Аккаунт A" }]; state.plan = "Free";
  state.read.mockReset(); state.read.mockImplementation(async () => ({ display_name: state.plan }));
});
describe("Account plan screen", () => {
  it("shows Free core/PDF and Advanced capabilities without invented pricing or checkout", async () => {
    const html = renderToStaticMarkup(await AccountPlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Текущий тариф: <strong>Free</strong>'); expect(html).toContain("PDF");
    expect(html).toContain("Несколько компаний"); expect(html).toContain("Оплата будет подключена на следующем этапе.");
    expect(html).not.toContain('<form'); expect(html).not.toContain('checkout'); expect(html).not.toMatch(/€|₽|\$\d/);
    expect(state.read).toHaveBeenCalledWith("account-a");
  });
  it("requires explicit Account choice when membership spans several Accounts", async () => {
    state.accounts.push({ id: "account-b", name: "Аккаунт B" });
    const html = renderToStaticMarkup(await AccountPlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Выберите аккаунт"); expect(state.read).not.toHaveBeenCalled();
  });
  it("does not fall back to an accessible Account for a forged foreign-account query", async () => {
    await expect(AccountPlanPage({ searchParams: Promise.resolve({ account: "foreign" }) })).rejects.toThrow('redirect:/ru/access-denied');
    expect(state.read).not.toHaveBeenCalled();
  });
  it("shows freshly read Advanced for the explicitly authorized Account", async () => {
    state.plan = "Advanced";
    const html = renderToStaticMarkup(await AccountPlanPage({ searchParams: Promise.resolve({ account: "account-a" }) }));
    expect(html).toContain('Текущий тариф: <strong>Advanced</strong>');
  });
});
