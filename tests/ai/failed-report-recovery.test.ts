import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  authorize: vi.fn(), generate: vi.fn(), from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/account/authorization", () => ({
  AccountAccessError: class extends Error {}, requireDiagnosticWrite: state.authorize,
}));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/server/ai/report", () => ({ buildAIInput: async () => ({ synthetic: true }), generateReport: state.generate }));
vi.mock("@/server-runtime/free-smoke", () => ({ assertFreeSmokeDiagnostic: vi.fn() }));

import { requestAIReportRegeneration, requestNextAIReportVersion } from "@/server/ai/regeneration";
import { AccountAccessError } from "@/server/account/authorization";
import { runAIJob } from "@/server/ai/worker";

// Models the existing two database unique constraints, including concurrent
// inserts. The real enqueue and worker code execute against these rows.
function from(table: string) {
  const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  let operation = "read";
  let value: Record<string, unknown> = {};
  let sort = "";
  const execute = () => {
    const rows = state.rows[table] ??= [];
    if (operation === "insert") {
      const duplicate = rows.some(r => r.diagnostic_id === value.diagnostic_id &&
        (table === "ai_reports" ? r.version === value.version : r.kind === value.kind && r.deduplication_key === value.deduplication_key));
      if (duplicate) return { data: null, error: { code: "23505" } };
      const row = { id: `${table}-${rows.length + 1}`, ...value }; rows.push(row);
      return { data: structuredClone(row), error: null };
    }
    const found = rows.filter(r => filters.every(f => f(r)));
    if (operation === "update") { found.forEach(r => Object.assign(r, value)); return { data: null, error: null }; }
    return { data: structuredClone(sort ? [...found].sort((a,b) => Number(b[sort])-Number(a[sort])) : found), error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string,v: unknown) => { filters.push(r => r[k] === v); return q; },
    in: (k: string,v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    order: (k: string) => { sort = k; return q; },
    insert: (v: Record<string, unknown>) => { operation = "insert"; value = v; return q; },
    update: (v: Record<string, unknown>) => { operation = "update"; value = v; return q; },
    maybeSingle: async () => { const r=execute(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => q.maybeSingle(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
  }; return q;
}
beforeEach(() => {
  vi.clearAllMocks(); state.from.mockImplementation(from);
  state.authorize.mockResolvedValue({ id: "diagnostic", status: "completed" });
  state.generate.mockResolvedValue({ content: { summary: "Synthetic completed report" }, requestId: "synthetic" });
  state.rows = {
    diagnostics: [{ id: "diagnostic", status: "completed" }],
    diagnostic_results: [{ id: "result", diagnostic_id: "diagnostic" }],
    ai_reports: [{ id: "v1", diagnostic_id: "diagnostic", version: 1, status: "failed", error_code: "historical_provider_401", input_snapshot: { historical: true } }],
    jobs: [{ id: "job1", kind: "ai_report", diagnostic_id: "diagnostic", deduplication_key: "ai_report_v1", status: "failed", attempts: 3, last_error_code: "historical" }],
  };
});
describe("versioned Individual failed-report recovery", () => {
  it.each(["failed", "completed"])("owner creates a separate next version from %s", async status => {
    state.rows.ai_reports[0].status=status;
    const oldReport=structuredClone(state.rows.ai_reports[0]),oldJob=structuredClone(state.rows.jobs[0]);
    const report=await requestAIReportRegeneration("owner", "diagnostic");
    expect(state.authorize).toHaveBeenCalledWith("diagnostic", "owner");
    expect(report).toMatchObject({ version: 2, status: "queued" });
    expect(state.rows.jobs[1]).toMatchObject({ deduplication_key: "ai_report_v2" });
    expect(state.rows.ai_reports[0]).toEqual(oldReport);expect(state.rows.jobs[0]).toEqual(oldJob);
  });
  it("creates v1 only when a completed result has no report history", async () => {
    state.rows.ai_reports=[];state.rows.jobs=[];
    expect(await requestNextAIReportVersion("diagnostic")).toMatchObject({version:1,status:"queued"});
    expect(state.rows.jobs[0]).toMatchObject({deduplication_key:"ai_report_v1"});
  });
  it("foreign owner is denied before service-role reads or enqueue", async () => {
    state.authorize.mockRejectedValue(new AccountAccessError("not_found"));
    await expect(requestAIReportRegeneration("foreign", "diagnostic")).rejects.toThrow("not_found");
    expect(state.from).not.toHaveBeenCalled();
  });
  it.each(["in_progress","submitted"])("denies incomplete diagnostic %s",async status=>{
    state.rows.diagnostics[0].status=status;
    await expect(requestNextAIReportVersion("diagnostic")).rejects.toThrow("not_found");expect(state.rows.jobs).toHaveLength(1);
  });
  it("denies completed diagnostic without result",async()=>{
    state.rows.diagnostic_results=[];
    await expect(requestNextAIReportVersion("diagnostic")).rejects.toThrow("not_found");expect(state.rows.ai_reports).toHaveLength(1);
  });
  it.each(["queued","generating"])("returns existing active %s version",async status=>{
    state.rows.ai_reports.push({id:"v2",diagnostic_id:"diagnostic",version:2,status});
    expect(await requestNextAIReportVersion("diagnostic")).toMatchObject({id:"v2",version:2,status});expect(state.rows.jobs).toHaveLength(1);
  });
  it("arbitrates concurrent owner/admin requests using real enqueue unique-conflict recovery",async()=>{
    const reports=await Promise.all(Array.from({length:10},(_,i)=>i%2?requestAIReportRegeneration("owner","diagnostic"):requestNextAIReportVersion("diagnostic")));
    expect(new Set(reports.map(r=>r.id)).size).toBe(1);expect(reports.every(r=>r.version===2)).toBe(true);
    expect(state.rows.ai_reports).toHaveLength(2);expect(state.rows.jobs).toHaveLength(2);
  });
  it("completes v2 without modifying failed v1/report job",async()=>{
    const before=JSON.stringify([state.rows.ai_reports[0],state.rows.jobs[0]]);
    await requestNextAIReportVersion("diagnostic");
    const job=state.rows.jobs[1];job.lease_token="lease";
    expect(await runAIJob({job_id:String(job.id),diagnostic_id:"diagnostic",lease_token:"lease",attempt_count:1,deduplication_key:"ai_report_v2"})).toEqual({status:"completed"});
    expect(state.rows.ai_reports[1].status).toBe("completed");
    expect(JSON.stringify([state.rows.ai_reports[0],state.rows.jobs[0]])).toBe(before);
  });
});
