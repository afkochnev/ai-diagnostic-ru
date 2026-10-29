import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  authorize: vi.fn(), generate: vi.fn(), from: vi.fn(), buildInput: vi.fn(),
  selects: [] as Array<{ table: string; columns: string }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/account/authorization", () => ({
  AccountAccessError: class extends Error {}, requireDiagnosticWrite: state.authorize,
}));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/server/ai/report", () => ({ buildAIInput: state.buildInput, generateReport: state.generate }));
vi.mock("@/server-runtime/free-smoke", () => ({ assertFreeSmokeDiagnostic: vi.fn() }));

import { requestAIReportRegeneration, requestNextAIReportVersion } from "@/server/ai/regeneration";
import { AccountAccessError } from "@/server/account/authorization";
import { runAIJob } from "@/server/ai/worker";
import { enqueueAIReport } from "@/server/ai/worker";
import { runScoringJob } from "@/server/scoring/worker";

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
    select: (columns: string) => { state.selects.push({ table, columns }); return q; },
    eq: (k: string,v: unknown) => { filters.push(r => r[k] === v); return q; },
    in: (k: string,v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    order: (k: string) => { sort = k; return q; },
    insert: (v: Record<string, unknown>) => { operation = "insert"; value = v; return q; },
    upsert: (values: Record<string, unknown>[]) => { (state.rows[table] ??= []).push(...structuredClone(values)); return q; },
    update: (v: Record<string, unknown>) => { operation = "update"; value = v; return q; },
    maybeSingle: async () => { const r=execute(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    single: async () => q.maybeSingle(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
  }; return q;
}
beforeEach(() => {
  vi.clearAllMocks(); state.from.mockImplementation(from);
  state.selects = [];
  state.buildInput.mockResolvedValue({ synthetic: true });
  state.authorize.mockResolvedValue({ id: "diagnostic", status: "completed" });
  state.generate.mockResolvedValue({ content: { summary: "Synthetic completed report" }, requestId: "synthetic" });
  state.rows = {
    diagnostics: [{ id: "diagnostic", status: "completed" }],
    diagnostic_results: [{ id: "result", diagnostic_id: "diagnostic" }],
    ai_reports: [{ id: "v1", diagnostic_id: "diagnostic", version: 1, status: "failed", prompt_version: "RU-1.0", error_code: "historical_provider_401", input_snapshot: { historical: true } }],
    jobs: [{ id: "job1", kind: "ai_report", diagnostic_id: "diagnostic", deduplication_key: "ai_report_v1", status: "failed", attempts: 3, last_error_code: "historical" }],
  };
});
describe("versioned Individual failed-report recovery", () => {
  it.each(["failed", "completed"])("owner creates a separate next version from %s", async status => {
    state.rows.ai_reports[0].status=status;
    const oldReport=structuredClone(state.rows.ai_reports[0]),oldJob=structuredClone(state.rows.jobs[0]);
    const report=await requestAIReportRegeneration("owner", "diagnostic");
    expect(state.authorize).toHaveBeenCalledWith("diagnostic", "owner");
    expect(report).toMatchObject({ version: 2, status: "queued", prompt_version: "RU-1.5" });
    expect(state.rows.jobs[1]).toMatchObject({ deduplication_key: "ai_report_v2" });
    expect(state.rows.ai_reports[0]).toEqual(oldReport);expect(state.rows.jobs[0]).toEqual(oldJob);
  });
  it("creates v1 only when a completed result has no report history", async () => {
    state.rows.ai_reports=[];state.rows.jobs=[];
    expect(await requestNextAIReportVersion("diagnostic")).toMatchObject({version:1,status:"queued",prompt_version:"RU-1.5"});
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
    expect(state.generate).toHaveBeenCalledWith({synthetic:true},"RU-1.5",expect.any(Number),"diagnostic");
    expect(JSON.stringify([state.rows.ai_reports[0],state.rows.jobs[0]])).toBe(before);
  });
  it("scoring completion enqueues the first report with the current prompt and v1 job key",async()=>{
    state.rows.diagnostics=[{id:"diagnostic",status:"submitted",version_id:"methodology"}];
    state.rows.ai_reports=[];state.rows.diagnostic_results=[];
    state.rows.jobs=[{id:"score",diagnostic_id:"diagnostic",kind:"score_diagnostic",status:"processing",lease_token:"lease"}];
    state.rows.diagnostic_blocks=Array.from({length:8},(_,i)=>({id:`block-${i}`,version_id:"methodology",weight:1,is_active:true}));
    state.rows.questions=state.rows.diagnostic_blocks.map((b,i)=>({id:`q-${i}`,block_id:b.id,version_id:"methodology",weight:1,is_active:true,is_required:true,reverse_score:false,answer_type:"scale_0_4"}));
    state.rows.answers=state.rows.questions.map(q=>({diagnostic_id:"diagnostic",question_id:q.id,numeric_value:2}));
    state.rows.maturity_levels=[{id:"developing",key:"developing",version_id:"methodology"}];
    expect(await runScoringJob({job_id:"score",diagnostic_id:"diagnostic",lease_token:"lease",attempt_count:1})).toEqual({status:"completed"});
    expect(state.rows.diagnostics[0].status).toBe("completed");
    expect(state.rows.ai_reports).toEqual([expect.objectContaining({version:1,prompt_version:"RU-1.5",status:"queued"})]);
    expect(state.rows.jobs.filter(j=>j.kind==="ai_report")).toEqual([expect.objectContaining({deduplication_key:"ai_report_v1"})]);
    expect(state.generate).not.toHaveBeenCalled();
  });
  it.each([1,2,3])("new generation v%i always persists current RU-1.5",async version=>{
    state.rows.ai_reports=[];state.rows.jobs=[];
    await enqueueAIReport("diagnostic",version);
    expect(state.rows.ai_reports[0]).toMatchObject({version,prompt_version:"RU-1.5"});
    expect(state.rows.jobs[0].deduplication_key).toBe(`ai_report_v${version}`);
  });
  it.each(["RU-1.0","RU-1.1","RU-1.2","RU-1.3","RU-1.5"])("worker uses persisted %s on generation v2",async prompt_version=>{
    state.rows.ai_reports=[{id:"v2",diagnostic_id:"diagnostic",version:2,status:"queued",prompt_version}];
    state.rows.jobs=[{id:"job2",lease_token:"lease",status:"processing"}];
    await runAIJob({job_id:"job2",diagnostic_id:"diagnostic",lease_token:"lease",attempt_count:1,deduplication_key:"ai_report_v2"});
    expect(state.selects).toContainEqual({table:"ai_reports",columns:"id,version,status,prompt_version"});
    expect(state.generate).toHaveBeenCalledExactlyOnceWith({synthetic:true},prompt_version,expect.any(Number),"diagnostic");
    expect(state.rows.ai_reports[0]).toMatchObject({version:2,prompt_version,status:"completed"});
  });
  it.each(["RU-9.9","",null,undefined,3])("unsupported persisted prompt %s fails terminally without input/provider/fallback",async prompt_version=>{
    state.rows.ai_reports=[{id:"bad",diagnostic_id:"diagnostic",version:2,status:"queued",prompt_version}];
    state.rows.jobs=[{id:"bad-job",status:"processing",lease_token:"lease"}];
    expect(await runAIJob({job_id:"bad-job",diagnostic_id:"diagnostic",lease_token:"lease",attempt_count:1,deduplication_key:"ai_report_v2"})).toEqual({status:"failed"});
    expect(state.buildInput).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
    expect(state.rows.ai_reports[0]).toMatchObject({prompt_version,status:"failed",error_code:"invalid_individual_prompt_version"});
    expect(state.rows.jobs[0]).toMatchObject({status:"failed",attempts:3,last_error_code:"invalid_individual_prompt_version",available_at:"2099-01-01T00:00:00.000Z",lease_token:null});
  });
});
