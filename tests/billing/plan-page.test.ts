import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ accounts: [{ id: "account-a", name: "Аккаунт A" }], plan: "Free", read: vi.fn(), company: vi.fn(), annual:vi.fn(),terms:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(`redirect:${p}`); } }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => state.accounts }));
vi.mock("@/server/entitlements", () => ({ getAccountPlan: state.read }));
vi.mock("@/server/account/authorization",()=>({requireCompanyRead:state.company}));
vi.mock('@/server/billing/service',async original=>({...await original<typeof import('@/server/billing/service')>(),annualAccess:state.annual}));
vi.mock('@/server/billing/legal',()=>({currentCommercialTerms:state.terms}));
vi.mock('@/server/acquisition/service',()=>({conversionContinuation:async()=>null}));
import AccountPlanPage from "@/app/[locale]/(workspace)/account/plan/page";
beforeEach(() => {
  state.terms.mockReset();state.terms.mockResolvedValue(null);
  state.accounts = [{ id: "account-a", name: "Аккаунт A" }]; state.plan = "Free";
  state.annual.mockReset();state.annual.mockResolvedValue(null);state.company.mockReset();state.company.mockResolvedValue({id:"30000000-0000-4000-8000-000000000001",name:"Legacy Company",account_id:"account-a"});
  state.read.mockReset(); state.read.mockImplementation(async () => ({ display_name: state.plan, plan: state.plan.toLowerCase(), entitlements: {team_diagnostics:state.plan==="Advanced",multi_company:state.plan==="Advanced"} }));
});
afterEach(()=>vi.unstubAllEnvs());
describe("Account plan screen", () => {
  function readyPayment(){for(const [k,v]of Object.entries({APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co',BILLING_PROVIDER:'yookassa',BILLING_ENABLED:'true',YOOKASSA_TEST_MODE:'true',YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'test_synthetic',YOOKASSA_RECEIPT_CONFIG_CONFIRMED:'true',YOOKASSA_PAYMENT_MODE_CONFIRMED:'true',YOOKASSA_PAYMENT_MODE:'full_payment',YOOKASSA_RECEIPT_SOLUTION:'external',YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE:'false'}))vi.stubEnv(k,v);}
  it('shows an exact version link and explicit acceptance with the document digest before checkout',async()=>{
    readyPayment();state.terms.mockResolvedValue({version:'advanced-terms-ru-v1',content_sha256:'a'.repeat(64)});
    const html=renderToStaticMarkup(await AccountPlanPage({searchParams:Promise.resolve({})}));
    expect(html).toContain('/ru/legal/advanced/advanced-terms-ru-v1');expect(html).toContain('name="terms_accepted"');expect(html).toContain('name="terms_sha256"');expect(html).toContain('a'.repeat(64));expect(html).toContain('info@iteam.ru');expect(html).toContain('аккаунт переходит на Free');
  });
  it('denies checkout when terms are unavailable even if all provider/fiscal gates pass',async()=>{
    readyPayment();state.terms.mockResolvedValue(null);
    const html=renderToStaticMarkup(await AccountPlanPage({searchParams:Promise.resolve({})}));
    expect(html).not.toContain('name="terms_accepted"');expect(html).toContain('Оплата временно недоступна');
  });
  it("shows approved no-VAT price but cannot checkout with unconfirmed fiscal mode",async()=>{
    vi.stubEnv('BILLING_PROVIDER','yookassa');vi.stubEnv('BILLING_ENABLED','true');
    const html=renderToStaticMarkup(await AccountPlanPage({searchParams:Promise.resolve({})}));
    expect(html).toContain('480 ₽');expect(html).toContain('Без НДС');expect(html).toContain('без автоматического продления');expect(html).toContain('Оплата временно недоступна');expect(html).not.toContain('name="terms_accepted"');expect(html).not.toContain('включая НДС');
  });
  it("offers explicit annual renewal and preserves the remaining paid term",async()=>{
    vi.stubEnv('BILLING_PROVIDER','yookassa');state.plan='Advanced';state.annual.mockResolvedValue({renewable:true,effective_until:'2027-10-21T12:00:00Z'});
    const html=renderToStaticMarkup(await AccountPlanPage({searchParams:Promise.resolve({})}));
    expect(html).toContain('Продлить Advanced на год');expect(html).toContain('21.10.2027');expect(html).toContain('оставшееся оплаченное время сохраняется');
  });
  it("shows Free core/PDF and Advanced capabilities without invented pricing or checkout while billing is disabled", async () => {
    const html = renderToStaticMarkup(await AccountPlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Текущий тариф: <strong>Free</strong>'); expect(html).toContain("PDF");
    expect(html).toContain("Несколько компаний"); expect(html).toContain("Стоимость и условия оплаты пока не настроены.");
    expect(html).not.toContain('name="terms_accepted"'); expect(html).not.toContain('name="terms_accepted"'); expect(html).not.toMatch(/€|₽|\$\d/);
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
    expect(state.company).toHaveBeenCalledWith(id,"owner");expect(html).toContain("Legacy Company");expect(html).toContain(`/ru/companies/${id}/diagnostics#choose`);
  });
  it("rejects a Company from another Account even if the caller can access both",async()=>{
    state.company.mockResolvedValue({id:"30000000-0000-4000-8000-000000000001",name:"Foreign context",account_id:"account-b"});
    await expect(AccountPlanPage({searchParams:Promise.resolve({account:"account-a",company:"30000000-0000-4000-8000-000000000001"})})).rejects.toThrow("redirect:/ru/access-denied");
  });
});
