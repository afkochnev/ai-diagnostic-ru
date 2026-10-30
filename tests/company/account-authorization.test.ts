vi.mock("@/server/entitlements", () => ({
  requireEntitlement: vi.fn(),
  getAccountPlan: async () => ({ plan: "advanced", display_name: "Advanced", entitlements: {multi_company: true, team_diagnostics: true} }),
  AdvancedRequiredError: class extends Error {}, advancedRequiredMessage: "Эта возможность доступна на тарифе Advanced.",
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import pdfReportSchema from "../../AI_REPORT_SCHEMA_RU_1_0.json";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  actor: { id: "10000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-10-12T00:00:00Z" } as { id: string; email_confirmed_at: string | null } | null,
  tables: {} as Record<string, Row[]>,
  queries: [] as string[],
  writes: [] as { table: string; values: Row }[],
  failInsert: null as { code: string } | null,
}));
const renderPdf = vi.hoisted(() => vi.fn());
const enqueueAIReport = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(`redirect:${path}`); }));
const requireAdmin = vi.hoisted(() => vi.fn());

function client() {
  return {
    auth: {
      getUser: async () => ({ data: { user: state.actor }, error: null }),
      admin: { listUsers: async () => ({ data: { users: (state.tables.users ?? []).map((user) => ({ ...user, email: `${user.id}@example.test` })) }, error: null }) },
    },
    from(table: string) {
      state.queries.push(table);
      const filters: ((row: Row) => boolean)[] = [];
      const sorts: { column: string; ascending: boolean }[] = [];
      let limit = Infinity;
      let insert: Row | null = null;
      let update: Row | null = null;
      const run = () => {
        if (insert) {
          if (state.failInsert) return { data: null, error: state.failInsert };
          const row = { id: "60000000-0000-4000-8000-000000000006", ...insert };
          state.tables[table] = [...(state.tables[table] ?? []), row];
          state.writes.push({ table, values: insert });
          insert = null;
          return { data: [row], error: null };
        }
        const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (update) {
          for (const row of rows) Object.assign(row, update);
          if (rows.length) state.writes.push({ table, values: update });
          update = null;
        }
        for (const sort of sorts.toReversed()) rows.sort((left, right) => String(left[sort.column] ?? "").localeCompare(String(right[sort.column] ?? "")) * (sort.ascending ? 1 : -1));
        return { data: rows.slice(0, limit), count: rows.length, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return chain; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return chain; },
        order: (column: string, options?: { ascending?: boolean }) => { sorts.push({ column, ascending: options?.ascending !== false }); return chain; },
        limit: (value: number) => { limit = value; return chain; },
        range: (_from: number, to: number) => { limit = to + 1; return chain; },
        insert: (value: Row) => { insert = value; return chain; },
        upsert: (value: Row) => { insert = value; return chain; },
        update: (value: Row) => { update = value; return chain; },
        maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
        single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
        then: (resolve: (value: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return chain;
    },
  };
}

vi.mock("@/server/supabase/server", () => ({ createAuthClient: () => client() }));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("@/server/pdf/render", () => ({ renderPdf }));
vi.mock("@/server/ai/worker", () => ({ enqueueAIReport }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: state.actor, role: "user", aal: "aal1" }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/admin", () => ({ requireAdmin }));

import { AccountAccessError, requireAccountRead, requireCompanyRead, requireDiagnosticRead } from "@/server/account/authorization";
import { listAccessibleAccounts } from "@/server/account/queries";
import { getCompanyForAccount, getOwnCompany, listAccessibleCompanies } from "@/server/company/queries";
import { createDiagnostic, getActiveDiagnostic, getLatestDiagnostics } from "@/server/diagnostic/service";
import { getFeedbackStatus } from "@/server/feedback/service";
import { getDiagnosticResult } from "@/server/diagnostic/result";
import { getPdfForReport, preparePdfForReport } from "@/server/pdf/service";
import { sendReportEmail } from "@/server/email/service";
import { requestAIReportRegeneration } from "@/server/ai/regeneration";
import { createCompanyForAccountAction, createCompanyProfileAction, saveCompanyProfileAction } from "@/server/company/actions";
import { getAdminCompanies, getAdminCompanyDetail, getAdminUsers, getAdminUserDetail } from "@/server/admin/companies-users";

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER_USER = "20000000-0000-4000-8000-000000000002";
const ACCOUNT = "30000000-0000-4000-8000-000000000003";
const OTHER_ACCOUNT = "40000000-0000-4000-8000-000000000004";
const COMPANY = "50000000-0000-4000-8000-000000000005";
const OTHER_COMPANY = "70000000-0000-4000-8000-000000000007";
const DIAGNOSTIC = "80000000-0000-4000-8000-000000000008";
const REPORT = "90000000-0000-4000-8000-000000000009";

const fixturePdf = (label: string) => Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`);
const fixtureArtifact = (reportId: string, label: string) => ({ id: "60000000-0000-4000-8000-000000000006", report_id: reportId, ai_report_version: 1, format: "pdf", template_version: "stage12-1i", status: "ready", content_base64: fixturePdf(label).toString("base64"), checksum: crypto.createHash("sha256").update(fixturePdf(label)).digest("hex") });

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://ai-diagnostic-staging-web.onrender.com");
  vi.stubEnv("SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co");
  state.actor = { id: USER, email_confirmed_at: "2026-10-12T00:00:00Z" };
  state.queries = [];
  state.writes = [];
  state.failInsert = null;
  renderPdf.mockReset();
  enqueueAIReport.mockReset();
  redirect.mockClear();
  requireAdmin.mockReset().mockResolvedValue({ user: { id: USER }, role: "administrator", aal: "aal2" });
  state.tables = {
    accounts: [{ id: ACCOUNT, name: "Workspace", status: "active" }, { id: OTHER_ACCOUNT, name: "Other", status: "active" }],
    account_memberships: [{ account_id: ACCOUNT, user_id: USER, role: "owner", status: "active" }, { account_id: OTHER_ACCOUNT, user_id: OTHER_USER, role: "owner", status: "active" }],
    company_profiles: [{ id: COMPANY, account_id: ACCOUNT, owner_user_id: OTHER_USER, name: "Company", revision: 3 }, { id: OTHER_COMPANY, account_id: OTHER_ACCOUNT, owner_user_id: USER, name: "Other" }],
    diagnostics: [{ id: DIAGNOSTIC, company_id: COMPANY, created_by_user_id: OTHER_USER, status: "in_progress", version_id: "v3" }],
    diagnostic_definitions: [{ id: "definition", key: "manageability" }],
    diagnostic_versions: [{ id: "v3", definition_id: "definition", version_number: 3, status: "retired" }, { id: "v4", definition_id: "definition", version_number: 4, status: "published" }],
    diagnostic_blocks: [{ id: "block", version_id: "v4", is_active: true, position: 1 }],
    ai_reports: [{ id: REPORT, diagnostic_id: DIAGNOSTIC, version: 1, status: "completed" }],
    diagnostic_results: [{ id: "result", diagnostic_id: DIAGNOSTIC }],
    industry_translations: [{ industry_key: "consulting", locale: "ru" }],
    revenue_range_translations: [{ revenue_key: "small", locale: "ru" }],
    users: [{ id: USER, full_name: "Owner" }, { id: OTHER_USER, full_name: "Other owner" }],
  };
});

function companyForm(extra: Record<string, string>) {
  const form = new FormData();
  const input = { name: "Second company", industry_key: "consulting", country: "Россия", products: "Services", customer_segments: "Companies", sales_channels: "Direct", employee_count: "10", annual_revenue_key: "small", company_age_years: "5", management_levels: "2", key_problems: "Growth", main_goals: "Efficiency", ...extra };
  for (const [field, value] of Object.entries(input)) form.set(field, value);
  return form;
}

describe("company profile mutations", () => {
  it("creates another company in the explicit account and retains existing company IDs", async () => {
    const form = companyForm({ account_id: ACCOUNT, return_to: "https://untrusted.example" });
    await expect(createCompanyProfileAction(COMPANY, {}, form)).rejects.toThrow("redirect:/ru/companies/60000000-0000-4000-8000-000000000006/diagnostics?new=1#choose");
    expect(state.tables.company_profiles[0].id).toBe(COMPANY);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ table: "company_profiles", values: { account_id: ACCOUNT, owner_user_id: USER, revision: 1 } });
  });

  it("edits the explicit accessible company without rewriting ownership provenance", async () => {
    await expect(saveCompanyProfileAction({}, companyForm({ company_id: COMPANY, account_id: ACCOUNT, revision: "3" }))).rejects.toThrow(`redirect:/ru/companies/${COMPANY}`);
    expect(state.writes[0].values.revision).toBe(4);
    expect(state.writes[0].values).not.toHaveProperty("owner_user_id");
    expect(state.writes[0].values).not.toHaveProperty("account_id");
    expect(state.tables.company_profiles[0].owner_user_id).toBe(OTHER_USER);
  });

  it("rejects stale profile revisions", async () => {
    expect(await saveCompanyProfileAction({}, companyForm({ company_id: COMPANY, revision: "2" }))).toHaveProperty("error");
    expect(state.tables.company_profiles[0].revision).toBe(3);
    expect(state.writes).toEqual([]);
  });

  it.each([{ company_id: OTHER_COMPANY, revision: "1" }, { account_id: OTHER_ACCOUNT }, { company_id: COMPANY, account_id: OTHER_ACCOUNT, revision: "3" }] as Array<Record<string, string>>)("rejects foreign or inconsistent form identifiers", async (selection) => {
    expect(await saveCompanyProfileAction({}, companyForm(selection))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });
});

describe("admin multi-company projections", () => {
  it("shows all companies through current memberships without singular owner lookups", async () => {
    state.tables.company_profiles.push({ id: "a0000000-0000-4000-8000-000000000001", account_id: ACCOUNT, owner_user_id: OTHER_USER, name: "Second" });
    const detail = await getAdminUserDetail(USER);
    expect(detail?.companies.map((company) => company.id)).toEqual([COMPANY, "a0000000-0000-4000-8000-000000000001"]);
    const users = await getAdminUsers();
    expect(users.rows.find((user) => user.id === USER)?.companyName).toBe("Company; Second");
    expect(state.writes).toEqual([]);
  });

  it("projects company owners from current membership while retaining historical creator diagnostics", async () => {
    const detail = await getAdminCompanyDetail(COMPANY);
    expect(detail?.users.map((user) => user.id)).toEqual([USER]);
    expect(detail?.diagnostics[0].created_by_user_id).toBe(OTHER_USER);
    const companies = await getAdminCompanies();
    expect(companies.rows.find((company) => company.id === COMPANY)?.userCount).toBe(1);
    expect(state.writes).toEqual([]);
  });

  it("removes revoked membership from user/company projections", async () => {
    state.tables.account_memberships[0].status = "revoked";
    expect((await getAdminUserDetail(USER))?.companies).toEqual([]);
    expect((await getAdminCompanyDetail(COMPANY))?.users).toEqual([]);
    expect((await getAdminCompanies()).rows.find((company) => company.id === COMPANY)?.userCount).toBe(0);
  });

  it("filters users by the company's current account owners", async () => {
    expect((await getAdminUsers({ company: COMPANY })).rows.map((user) => user.id)).toEqual([USER]);
  });

  it("retains the global administrator/MFA boundary before service-role reads", async () => {
    requireAdmin.mockRejectedValue(new Error("mfa_required"));
    await expect(getAdminUserDetail(USER)).rejects.toThrow("mfa_required");
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
  });
});

describe("current account membership authorization", () => {
  it("lists only accounts and companies connected by the active owner membership", async () => {
    expect((await listAccessibleAccounts(USER)).map((row) => row.id)).toEqual([ACCOUNT]);
    expect((await listAccessibleCompanies(USER)).map((row) => row.id)).toEqual([COMPANY]);
  });

  it("allows the current owner even when historical creator/owner differ", async () => {
    expect((await requireCompanyRead(COMPANY, USER)).owner_user_id).toBe(OTHER_USER);
    expect((await requireDiagnosticRead(DIAGNOSTIC, USER)).created_by_user_id).toBe(OTHER_USER);
    expect((await getActiveDiagnostic(USER, COMPANY))?.id).toBe(DIAGNOSTIC);
  });

  it("rejects a foreign account or company even when owner provenance equals the actor", async () => {
    await expect(requireAccountRead(OTHER_ACCOUNT, USER)).rejects.toMatchObject({ code: "not_found" });
    await expect(requireCompanyRead(OTHER_COMPANY, USER)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a mismatched account/company pair", async () => {
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    await expect(getCompanyForAccount(OTHER_ACCOUNT, COMPANY, USER)).rejects.toMatchObject({ code: "not_found" });
  });

  it("binds the identity argument to the actual cookie actor", async () => {
    await expect(listAccessibleAccounts(OTHER_USER)).rejects.toBeInstanceOf(AccountAccessError);
    expect(state.queries).toEqual([]);
  });

  it.each([null, { id: USER, email_confirmed_at: null }])("rejects absent or unverified sessions before table reads", async (actor) => {
    state.actor = actor;
    await expect(requireAccountRead(ACCOUNT, USER)).rejects.toMatchObject({ code: "not_found" });
    expect(state.queries).toEqual([]);
  });

  it("revocation blocks future reads even while historical rows remain", async () => {
    expect((await requireDiagnosticRead(DIAGNOSTIC, USER)).id).toBe(DIAGNOSTIC);
    state.tables.account_memberships[0].status = "revoked";
    await expect(requireDiagnosticRead(DIAGNOSTIC, USER)).rejects.toMatchObject({ code: "not_found" });
    expect(await listAccessibleCompanies(USER)).toEqual([]);
    expect(await getDiagnosticResult(DIAGNOSTIC, USER)).toBeNull();
  });

  it("archiving an account denies its companies and diagnostics", async () => {
    state.tables.accounts[0].status = "archived";
    await expect(requireCompanyRead(COMPANY, USER)).rejects.toMatchObject({ code: "not_found" });
    await expect(getLatestDiagnostics(USER, COMPANY)).rejects.toMatchObject({ code: "not_found" });
  });

  it("fails closed on malformed company identifiers", async () => {
    await expect(requireCompanyRead("not-a-uuid", USER)).rejects.toMatchObject({ code: "not_found" });
    expect(state.queries).toEqual([]);
  });
});

describe("explicit company selection and V1 start compatibility", () => {
  it("retains the zero/one-company compatibility path", async () => {
    expect((await getOwnCompany(USER))?.id).toBe(COMPANY);
    state.tables.company_profiles = [];
    expect(await getOwnCompany(USER)).toBeNull();
    await expect(createDiagnostic(USER)).rejects.toMatchObject({ code: "company_missing" });
  });

  it("requires selection when two companies are accessible", async () => {
    state.tables.company_profiles.push({ id: OTHER_COMPANY, account_id: ACCOUNT });
    await expect(getOwnCompany(USER)).rejects.toMatchObject({ code: "selection_required" });
    await expect(createDiagnostic(USER)).rejects.toMatchObject({ code: "selection_required" });
    expect(state.writes).toEqual([]);
  });

  it("resumes the chosen company's historical attempt before current methodology lookup", async () => {
    state.tables.diagnostic_versions = [];
    expect(await createDiagnostic(USER, COMPANY)).toEqual({ id: DIAGNOSTIC, existing: true });
    expect(state.queries).not.toContain("diagnostic_versions");
    expect(state.writes).toEqual([]);
  });

  it("pins the published methodology for a new attempt and keeps creator attribution", async () => {
    state.tables.diagnostics = [];
    expect(await createDiagnostic(USER, COMPANY)).toMatchObject({ existing: false });
    expect(state.writes).toEqual([{ table: "diagnostics", values: { company_id: COMPANY, created_by_user_id: USER, version_id: "v4", locale: "ru", current_block_id: "block" } }]);
  });

  it("cannot start a foreign company's diagnostic", async () => {
    await expect(createDiagnostic(USER, OTHER_COMPANY)).rejects.toMatchObject({ code: "not_found" });
    expect(state.writes).toEqual([]);
  });
});

describe("service-role report boundaries", () => {
  it.each([getPdfForReport, preparePdfForReport, sendReportEmail])("denies a report after current membership is revoked", async (operation) => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.account_memberships[0].status = "revoked";
    await expect(operation(REPORT, USER)).rejects.toThrow(/access_denied/);
    expect(renderPdf).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("does not regenerate a report for a revoked historical creator", async () => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.diagnostics[0].created_by_user_id = USER;
    state.tables.account_memberships[0].status = "revoked";
    await expect(requestAIReportRegeneration(USER, DIAGNOSTIC)).rejects.toThrow("not_found");
    expect(enqueueAIReport).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("returns stored version-bound PDF bytes to the active account owner", async () => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.diagnostics[0].completed_at = "2026-10-12T00:00:00Z";
    state.tables.diagnostic_company_snapshots = [{ diagnostic_id: DIAGNOSTIC, profile_data: { name: "Company" } }];
    state.tables.report_artifacts = [fixtureArtifact(REPORT, "historical-pdf")];
    expect((await getPdfForReport(REPORT, USER)).bytes.toString()).toBe(fixturePdf("historical-pdf").toString());
    expect(renderPdf).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("allocates a new report revision for the active owner without creator equality", async () => {
    state.tables.diagnostics[0].status = "completed";
    enqueueAIReport.mockResolvedValue({ id: "new-report", version: 2, status: "queued" });
    expect(await requestAIReportRegeneration(USER, DIAGNOSTIC)).toMatchObject({ version: 2 });
    expect(enqueueAIReport).toHaveBeenCalledWith(DIAGNOSTIC, 2);
  });

  it("reauthorizes duplicate preparation while an older request is rendering", async () => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.diagnostics[0].completed_at = "2026-10-12T00:00:00Z";
    state.tables.diagnostic_company_snapshots = [{ diagnostic_id: DIAGNOSTIC, profile_data: { name: "Company" } }];
    state.tables.ai_reports[0].structured_content = Object.fromEntries(Object.entries(pdfReportSchema.properties).map(([k, v]) => [k, v.type === "string" ? "Synthetic report" : Array.from({ length: (v as { minItems: number }).minItems }, () => "Synthetic item")]));
    let completeRender!: (bytes: Buffer) => void;
    let enteredRender!: () => void;
    const rendering = new Promise<Buffer>((resolve) => { completeRender = resolve; });
    const entered = new Promise<void>((resolve) => { enteredRender = resolve; });
    renderPdf.mockImplementation(() => { enteredRender(); return rendering; });

    const originalRequest = preparePdfForReport(REPORT, USER);
    await entered;
    state.tables.account_memberships[0].status = "revoked";
    await expect(preparePdfForReport(REPORT, USER)).rejects.toThrow("pdf_access_denied");
    expect(renderPdf).toHaveBeenCalledTimes(1);
    completeRender(fixturePdf("prepared-pdf"));
    await expect(originalRequest).rejects.toThrow("pdf_access_denied");
    expect(state.writes.filter((write) => write.table === "report_artifacts")).toHaveLength(0);
  });
});


describe("V21B authoritative multi-company creation", () => {
  it("creates the first Company in an explicitly server-bound accessible Account", async () => {
    state.tables.company_profiles = [];
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    await expect(createCompanyForAccountAction(ACCOUNT, null, {}, companyForm({ account_id: ACCOUNT }))).rejects.toThrow("/diagnostics?new=1#choose");
    expect(state.writes.map(write => write.table)).toEqual(["company_profiles"]);
    expect(state.writes[0].values.account_id).toBe(ACCOUNT);
  });

  it("cannot change the bound workspace using a different owned hidden account_id", async () => {
    state.tables.company_profiles = [];
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    expect(await createCompanyForAccountAction(ACCOUNT, null, {}, companyForm({ account_id: OTHER_ACCOUNT }))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("rechecks membership for a bound workspace and rejects mismatched source context", async () => {
    expect(await createCompanyForAccountAction(OTHER_ACCOUNT, null, {}, companyForm({ account_id: OTHER_ACCOUNT }))).toHaveProperty("error");
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    expect(await createCompanyForAccountAction(OTHER_ACCOUNT, COMPANY, {}, companyForm({ account_id: OTHER_ACCOUNT }))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("derives the sole account for a first company without inserting an account or membership", async () => {
    state.tables.company_profiles = [];
    const before = JSON.stringify([state.tables.accounts, state.tables.account_memberships]);
    await expect(createCompanyProfileAction(null, {}, companyForm({}))).rejects.toThrow("/diagnostics?new=1#choose");
    expect(state.writes.map((write) => write.table)).toEqual(["company_profiles"]);
    expect(state.writes[0].values).toMatchObject({ account_id: ACCOUNT, owner_user_id: USER });
    expect(JSON.stringify([state.tables.accounts, state.tables.account_memberships])).toBe(before);
  });

  it("cannot attach a new company to a client-chosen foreign account", async () => {
    expect(await createCompanyProfileAction(COMPANY, {}, companyForm({ account_id: OTHER_ACCOUNT }))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("rejects a foreign source company before any insertion", async () => {
    expect(await createCompanyProfileAction(OTHER_COMPANY, {}, companyForm({}))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("rejects an alternate owned account_id instead of overriding current company context", async () => {
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    expect(await createCompanyProfileAction(COMPANY, {}, companyForm({ account_id: OTHER_ACCOUNT }))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("requires selection when creation has no company context and multiple accounts", async () => {
    state.tables.account_memberships.push({ account_id: OTHER_ACCOUNT, user_id: USER, role: "owner", status: "active" });
    await expect(createCompanyProfileAction(null, {}, companyForm({ account_id: ACCOUNT }))).rejects.toThrow("redirect:/ru/companies");
    expect(state.writes).toEqual([]);
  });

  it("limits additional creation to the staging preview while allowing first-company onboarding", async () => {
    vi.stubEnv("APP_URL", "https://audit.iteam.ru");
    expect(await createCompanyProfileAction(COMPANY, {}, companyForm({}))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
    state.tables.company_profiles = [];
    await expect(createCompanyProfileAction(null, {}, companyForm({}))).rejects.toThrow("/diagnostics?new=1#choose");
  });

  it("does not use the global administrator role as a company membership substitute", async () => {
    state.tables.user_roles = [{ user_id: USER, role: "administrator" }];
    state.tables.account_memberships = [];
    await expect(requireCompanyRead(COMPANY, USER)).rejects.toMatchObject({ code: "not_found" });
    expect(await createCompanyProfileAction(COMPANY, {}, companyForm({}))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("rejects unconfirmed owners even when a caller reaches the mutation service", async () => {
    state.actor!.email_confirmed_at = null;
    expect(await createCompanyProfileAction(COMPANY, {}, companyForm({}))).toHaveProperty("error");
    expect(state.writes).toEqual([]);
  });

  it("keeps two same-account diagnostic histories independent", async () => {
    const second = "a0000000-0000-4000-8000-000000000001";
    state.tables.company_profiles.push({ id: second, account_id: ACCOUNT });
    state.tables.diagnostics.push({ id: "second-diagnostic", company_id: second, status: "in_progress" });
    expect((await getLatestDiagnostics(USER, COMPANY)).map((row) => row.diagnostic.id)).toEqual([DIAGNOSTIC]);
    expect((await getLatestDiagnostics(USER, second)).map((row) => row.diagnostic.id)).toEqual(["second-diagnostic"]);
    expect(await createDiagnostic(USER, second)).toEqual({ id: "second-diagnostic", existing: true });
    expect((await getActiveDiagnostic(USER, COMPANY))?.id).toBe(DIAGNOSTIC);
  });

  it("loads a diagnostic's own report when a sibling company has a newer report", async () => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.ai_reports.push({ id: "sibling-report", diagnostic_id: "sibling-diagnostic", status: "completed", version: 99 });
    expect((await getDiagnosticResult(DIAGNOSTIC, USER))?.aiReport?.id).toBe(REPORT);
  });

  it("returns only the requested report's stored PDF within a multi-company account", async () => {
    state.tables.diagnostics[0].status = "completed";
    state.tables.diagnostics[0].completed_at = "2026-10-12T00:00:00Z";
    state.tables.diagnostic_company_snapshots = [{ diagnostic_id: DIAGNOSTIC, profile_data: { name: "Company" } }];
    state.tables.report_artifacts = [
      fixtureArtifact("sibling-report", "sibling-pdf"),
      fixtureArtifact(REPORT, "own-pdf"),
    ];
    expect((await getPdfForReport(REPORT, USER)).bytes.toString()).toBe(fixturePdf("own-pdf").toString());
    expect(renderPdf).not.toHaveBeenCalled();
  });
});


describe("V21B company resource boundaries", () => {
  it("does not read results or PDFs belonging to another account", async () => {
    state.tables.diagnostics[0].company_id = OTHER_COMPANY;
    state.tables.diagnostics[0].status = "completed";
    expect(await getDiagnosticResult(DIAGNOSTIC, USER)).toBeNull();
    await expect(getPdfForReport(REPORT, USER)).rejects.toThrow("pdf_access_denied");
    expect(state.writes).toEqual([]);
  });

  it("keeps feedback state scoped to the requested diagnostic within an account", async () => {
    const second = "a0000000-0000-4000-8000-000000000001";
    const secondDiagnostic = "b0000000-0000-4000-8000-000000000001";
    state.tables.company_profiles.push({ id: second, account_id: ACCOUNT });
    state.tables.diagnostics.push({ id: secondDiagnostic, company_id: second, status: "completed" });
    state.tables.feedback = [{ id: "feedback-b", diagnostic_id: secondDiagnostic, user_id: USER }];
    expect(await getFeedbackStatus(DIAGNOSTIC)).toBe(false);
    expect(await getFeedbackStatus(secondDiagnostic)).toBe(true);
  });
});
