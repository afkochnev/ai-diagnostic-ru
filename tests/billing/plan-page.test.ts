import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ accounts: [{ id: "account-a", name: "Аккаунт A" }], plan: "Free", read: vi.fn(), company: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(`redirect:${p}`); } }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => state.accounts }));
vi.mock("@/server/entitlements", () => ({ getAccountPlan: state.read }));
vi.mock("@/server/account/authorization",()=>({requireCompanyRead:state.company}));
import AccountPlanPage from "@/app/[locale]/(workspace)/account/plan/page";
beforeEach(() => {
  state.accounts = [{ id: "account-a", name: "Аккаунт A" }]; state.plan = "Free";
  state.company.mockReset();state.company.mockResolvedValue({id:"30000000-0000-4000-8000-000000000001",name:"Legacy Company",account_id:"account-a"});
  state.read.mockReset(); state.read.mockImplementation(async () => ({ display_name: state.plan, plan: state.plan.toLowerCase(), entitlements: {team_diagnostics:state.plan==="Advanced",multi_company:state.plan==="Advanced"} }));
});
describe("Account plan screen", () => {
  it("shows Free core/PDF and Advanced capabilities without invented pricing or checkout while billing is disabled", async () => {
    const html = renderToStaticMarkup(await AccountPlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Текущий тариф: <strong>Free</strong>'); expect(html).toContain("PDF");
    expect(html).toContain("Несколько компаний"); expect(html).toContain("Стоимость и условия оплаты пока не настроены.");
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
  it("preserves an authorized legacy Company without inventing a second acquisition intent",async()=>{
    const id="30000000-0000-4000-8000-000000000001";
    const html=renderToStaticMarkup(await AccountPlanPage({searchParams:Promise.resolve({account:"account-a",company:id})}));
    expect(state.company).toHaveBeenCalledWith(id,"owner");expect(html).toContain("Legacy Company");expect(html).toContain(`/ru/companies/${id}/team-explainer`);
  });
  it("rejects a Company from another Account even if the caller can access both",async()=>{
    state.company.mockResolvedValue({id:"30000000-0000-4000-8000-000000000001",name:"Foreign context",account_id:"account-b"});
    await expect(AccountPlanPage({searchParams:Promise.resolve({account:"account-a",company:"30000000-0000-4000-8000-000000000001"})})).rejects.toThrow("redirect:/ru/access-denied");
  });
});
