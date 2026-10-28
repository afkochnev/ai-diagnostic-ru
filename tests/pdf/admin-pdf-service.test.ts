import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import schema from "../../AI_REPORT_SCHEMA_RU_1_0.json";
const m = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), db: vi.fn(), owner: vi.fn(), render: vi.fn(), insert: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/admin", () => ({ requireAdmin: m.admin }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ rpc: m.rpc }) }));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: m.db }));
vi.mock("@/server/account/authorization", () => ({ requireDiagnosticRead: m.owner, AccountAccessError: class extends Error {} }));
vi.mock("@/server/pdf/render", () => ({ renderPdf: m.render }));
vi.mock("@/server/ai/report", () => { throw Error("AI must not be imported"); });
vi.mock("@/server/ai/worker", () => { throw Error("enqueue must not be imported"); });
import { getAdminPdfStatus, getPdfForReport, preparePdfForAdminReport, preparePdfForReport, templateVersion } from "@/server/pdf/service";
const id = "10000000-0000-4000-8000-000000000001", diagnosticId = "20000000-0000-4000-8000-000000000001", artifactId = "30000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const pdf = Buffer.from("%PDF-1.7\nmock-only-no-renderer\n%%EOF\n");
const digest = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const content = () => Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, v.type === "string" ? "Synthetic report" : Array.from({ length: (v as { minItems: number }).minItems }, () => "Synthetic item")]));
function stored(overrides: Row = {}) { return { id: artifactId, report_id: id, ai_report_version: 2, format: "pdf", template_version: templateVersion, status: "ready", content_base64: pdf.toString("base64"), checksum: digest(pdf), ...overrides }; }
function from(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => structuredClone((tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v)));
  const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; }, order: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    insert: (row: Row) => { expect(table).toBe("report_artifacts"); return m.insert(row); } };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  tables = { ai_reports: [{ id, diagnostic_id: diagnosticId, version: 2, status: "completed", structured_content: content() }],
    diagnostics: [{ id: diagnosticId, status: "completed", version_id: "definition", completed_at: "2026-10-21T00:00:00Z", company_id: "foreign-company", created_by_user_id: "foreign-owner" }],
    diagnostic_company_snapshots: [{ diagnostic_id: diagnosticId, profile_data: { name: "Synthetic company" } }],
    diagnostic_results: [{ diagnostic_id: diagnosticId, id: "result", display_manageability_index: 52.2, maturity_level_id: "maturity" }],
    maturity_level_translations: [{ maturity_level_id: "maturity", locale: "ru", label: "Зона развития" }],
    diagnostic_blocks: [{ id: "block", key: "strategy", weight: 1, position: 1, version_id: "definition", is_active: true }],
    diagnostic_block_results: [{ result_id: "result", block_id: "block", display_score: 62.5 }], diagnostic_block_translations: [{ block_id: "block", title: "Стратегия", locale: "ru" }], report_artifacts: [] };
  m.admin.mockResolvedValue({ user: { id: "actual-admin" } }); m.rpc.mockResolvedValue({ data: { administrator: true }, error: null });
  m.owner.mockImplementation(async () => structuredClone(tables.diagnostics[0]));
  m.db.mockReturnValue({ from }); m.render.mockResolvedValue(pdf);
  m.insert.mockImplementation(async (row: Row) => { tables.report_artifacts.push({ id: artifactId, ...row }); return { error: null }; });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("network forbidden in mock test"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("live-admin PDF entry and immutable shared renderer", () => {
  it.each(["anonymous", "unverified", "user", "revoked-role", "revoked-session", "service-role-header-only"])("direct service denies %s before privileged reads", async reason => {
    m.admin.mockRejectedValue(Error(`denied-${reason}`));
    await expect(preparePdfForAdminReport(id)).rejects.toThrow("denied"); await expect(getAdminPdfStatus(id)).rejects.toThrow("denied");
    expect(m.db).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it.each([{ data: { administrator: false }, error: null }, { data: null, error: { message: "secret" } }])("uncached live RPC denies stale requireAdmin result", async value => {
    m.rpc.mockResolvedValue(value); await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_access_denied"); expect(m.db).not.toHaveBeenCalled();
  });
  it("prepares foreign owner's exact completed report and downloads identical bytes through unchanged owner authorization", async () => {
    const ready = await preparePdfForAdminReport(id); expect(ready).toMatchObject({ report_id: id, ai_report_version: 2, artifact_id: artifactId, template_version: templateVersion, checksum: digest(pdf) });
    expect(m.owner).not.toHaveBeenCalled(); expect(m.insert).toHaveBeenCalledOnce(); expect(m.render).toHaveBeenCalledOnce();
    expect(m.render.mock.calls[0][0]).toMatchObject({ index: "52,2", report: content() });
    expect((await getPdfForReport(id, "actual-owner")).bytes).toEqual(pdf); expect(m.owner).toHaveBeenCalledWith(diagnosticId, "actual-owner"); expect(fetch).not.toHaveBeenCalled();
  });
  it("owner prepares through the same core while admin status is read-only", async () => {
    expect(await preparePdfForReport(id, "actual-owner")).toMatchObject({ status: "ready" });
    expect(m.admin).not.toHaveBeenCalled(); const writes = m.insert.mock.calls.length;
    expect((await getAdminPdfStatus(id)).artifact_id).toBe(artifactId); expect(m.insert).toHaveBeenCalledTimes(writes); expect(m.render).toHaveBeenCalledOnce();
  });
  it("missing artifact status GET never renders or writes", async () => {
    await expect(getAdminPdfStatus(id)).rejects.toThrow("pdf_artifact_not_ready"); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it("valid cached ready artifact is reused byte-for-byte without render/write", async () => {
    tables.report_artifacts.push(stored()); const before = JSON.stringify(tables.report_artifacts);
    expect((await preparePdfForAdminReport(id)).artifact_id).toBe(artifactId); expect(JSON.stringify(tables.report_artifacts)).toBe(before); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it.each(["failed", "queued", "generating"])("rejects %s report including historical v1 without fallback", async status => {
    tables.ai_reports[0].status = status; tables.ai_reports[0].version = 1;
    await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_report_not_ready"); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it("never selects another completed report on unknown exact id", async () => {
    await expect(preparePdfForAdminReport("10000000-0000-4000-8000-000000000099")).rejects.toThrow("pdf_access_denied"); expect(m.render).not.toHaveBeenCalled();
  });
  it.each(["diagnostic_company_snapshots", "diagnostic_results"])("missing %s fails without rendering", async table => {
    tables[table] = []; await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_result_missing"); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...content(), summary: "" }, { ...content(), strengths: ["only-one"] }, { ...content(), unknown: "not schema" }])("rejects missing/malformed saved content", async value => {
    tables.ai_reports[0].structured_content = value; await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_report_not_ready"); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it.each([{ ai_report_version: 1 }, { status: "failed" }, { checksum: "0".repeat(64) }, { content_base64: Buffer.from("not a PDF").toString("base64") }, { content_base64: pdf.toString("base64") + "!" }])("bad existing artifact is not overwritten or rendered", async change => {
    tables.report_artifacts.push(stored(change)); const before = JSON.stringify(tables.report_artifacts);
    await expect(preparePdfForAdminReport(id)).rejects.toThrow(/pdf_(artifact_conflict|integrity_failed)/); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled(); expect(JSON.stringify(tables.report_artifacts)).toBe(before);
  });
  it("oversized cached PDF fails before any renderer/write", async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1); tables.report_artifacts.push(stored({ content_base64: huge.toString("base64"), checksum: digest(huge) }));
    await expect(getAdminPdfStatus(id)).rejects.toThrow("pdf_integrity_failed"); expect(m.render).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it.each(["source", "role", "session"])("revoked/changed %s during rendering prevents publication", async change => {
    m.render.mockImplementation(async () => { if (change === "source") (tables.diagnostic_company_snapshots[0].profile_data as Row).name = "changed"; else m.rpc.mockResolvedValue({ data: { administrator: false }, error: null }); return pdf; });
    await expect(preparePdfForAdminReport(id)).rejects.toThrow(change === "source" ? "pdf_source_conflict" : "pdf_access_denied"); expect(m.insert).not.toHaveBeenCalled();
  });
  it("owner and admin concurrent calls share work but never caller identity", async () => {
    await Promise.all([preparePdfForReport(id, "real-owner"), preparePdfForAdminReport(id), preparePdfForAdminReport(id)]);
    expect(m.render).toHaveBeenCalledOnce(); expect(m.insert).toHaveBeenCalledOnce(); expect(m.owner).toHaveBeenCalledWith(diagnosticId, "real-owner"); expect(m.owner).not.toHaveBeenCalledWith(diagnosticId, "foreign-owner");
  });
  it("23505 across runtimes reuses the exact durable winner without overwrite", async () => {
    const winner = stored(); m.insert.mockImplementation(async () => { tables.report_artifacts.push(winner); return { error: { code: "23505" } }; });
    expect((await preparePdfForAdminReport(id)).checksum).toBe(winner.checksum); expect(tables.report_artifacts).toEqual([winner]); expect(m.insert).toHaveBeenCalledOnce();
  });
  it("unreadable conflicting persistence does not retry or overwrite", async () => {
    m.insert.mockResolvedValue({ error: { code: "23505" } }); await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_artifact_not_ready"); expect(m.insert).toHaveBeenCalledOnce(); expect(m.render).toHaveBeenCalledOnce();
  });
  it("unknown write result stops; read-only reconciliation may observe the created artifact", async () => {
    m.insert.mockImplementation(async (row: Row) => { tables.report_artifacts.push({ id: artifactId, ...row }); return { error: { code: "unknown" } }; });
    await expect(preparePdfForAdminReport(id)).rejects.toThrow("pdf_prepare_failed"); expect((await getAdminPdfStatus(id)).artifact_id).toBe(artifactId); expect(m.insert).toHaveBeenCalledOnce(); expect(m.render).toHaveBeenCalledOnce();
  });
  it("safe logs have bound actor/id metadata and exclude arbitrary exception material", async () => {
    m.render.mockRejectedValue(Error("secret credentials answers provider output")); await expect(preparePdfForAdminReport(id)).rejects.toThrow();
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls); expect(logs).toContain("actual-admin"); expect(logs).toContain("pdf_prepare_failed"); expect(logs).not.toMatch(/secret credentials|provider output|Synthetic report/);
  });
});
