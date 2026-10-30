import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyProfileSchema } from "@/validation/company";
import { encodeProfileDraft, profileDraftKey, readProfileDraft } from "@/features/company/profile-draft";

const m = vi.hoisted(() => ({ own: vi.fn(), write: vi.fn(), insert: vi.fn(), revenue: vi.fn(), context: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/server/company/queries", () => ({ getOwnCompany: m.own }));
vi.mock("@/server/company/creation", () => ({ companyCreationContext: m.context }));
vi.mock("@/server/account/authorization", () => ({
  AccountAccessError: class extends Error {}, requireAccountWrite: vi.fn(), requireCompanyWrite: m.write,
}));
vi.mock("@/server/entitlements", () => ({ AdvancedRequiredError: class extends Error {}, advancedRequiredMessage: "advanced" }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, insert: m.insert, update: () => query,
    maybeSingle: async () => table === "industry_translations" ? { data: { industry_key: "other" } } : table === "revenue_range_translations" ? m.revenue() : { data: { id: "created" } },
    single: async () => ({ data: { id: "created" } }),
  };
  m.insert.mockImplementation(() => query);
  return query;
} }) }));
import { createCompanyForAccountAction, createCompanyProfileAction, saveCompanyProfileAction } from "@/server/company/actions";

const minimal = { name: "Компания", industry_key: "other", products: "Услуги", employee_count: "8", key_problems: "Нет ясных приоритетов", main_goals: "Согласовать цели" };
function form() { const form = new FormData(); for (const [key, value] of Object.entries(minimal)) form.set(key, value); return form; }
beforeEach(() => { vi.clearAllMocks(); m.own.mockResolvedValue(null); m.context.mockResolvedValue({ account: { id: "account" } }); m.revenue.mockResolvedValue({ data: { revenue_key: "10m_100m" } }); });

describe("minimal company entry", () => {
  it("accepts six required fields and stores omitted context as null", () => {
    const parsed = companyProfileSchema.parse(minimal);
    for (const key of ["country", "customer_segments", "sales_channels", "annual_revenue_key", "company_age_years", "management_levels"] as const) expect(parsed[key]).toBeNull();
    expect(companyProfileSchema.parse({ ...minimal, company_age_years: "0" }).company_age_years).toBe(0);
    expect(companyProfileSchema.safeParse({ ...minimal, management_levels: "0" }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ ...minimal, employee_count: "" }).success).toBe(false);
  });
  it.each(["legacy", "new", "account"])("continues %s creation to diagnostic selection", async (route) => {
    const action = route === "legacy" ? saveCompanyProfileAction : route === "new" ? createCompanyProfileAction.bind(null, null) : createCompanyForAccountAction.bind(null, "account", null);
    await expect(action({}, form())).rejects.toThrow("redirect:/ru/companies/created/diagnostics?new=1#choose");
    expect(m.revenue).not.toHaveBeenCalled();
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ annual_revenue_key: null, management_levels: null, account_id: "account" }));
  });
  it("validates a supplied revenue reference and preserves the form on failure", async () => {
    const submitted = form(); submitted.set("annual_revenue_key", "missing");
    m.revenue.mockResolvedValue({ data: null });
    const result = await saveCompanyProfileAction({}, submitted);
    expect(result.fieldErrors?.annual_revenue_key).toBeTruthy();
    expect(result.values?.name).toBe("Компания"); expect(m.insert).not.toHaveBeenCalled();
  });
});

describe("company profile browser draft", () => {
  it("isolates users, workspaces and companies", () => {
    const key = profileDraftKey("u", "a", "c");
    expect(profileDraftKey("u2", "a", "c")).not.toBe(key);
    expect(profileDraftKey("u", "a2", "c")).not.toBe(key);
    expect(profileDraftKey("u", "a", "c2")).not.toBe(key);
    expect(profileDraftKey("u", "a")).not.toBe(key);
  });
  it("restores only known form fields for the same revision before expiry", () => {
    const draft = encodeProfileDraft({ ...minimal, password: "never-store", revision: "3" }, "3", 1000);
    expect(draft).not.toContain("never-store");
    expect(readProfileDraft(draft, "3", 2000)?.name).toBe("Компания");
    expect(readProfileDraft(draft, "4", 2000)).toBeNull();
    expect(readProfileDraft(draft, "3", 1000 + 8 * 86400000)).toBeNull();
    expect(readProfileDraft("broken", "3", 2000)).toBeNull();
  });
});
