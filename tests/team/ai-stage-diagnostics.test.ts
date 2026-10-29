import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai/core/error";
import { z } from "zod";
import { logTeamAIStageFailure } from "@/server/team/ai-stage-diagnostics";
import { emptyTeamCallCounts } from "@/server/team/report-v2-provider";
import { generateTeamReportV3, mockTeamSynthesisV3, repairV3Fields, synthesizeTeamTextsV3 } from "@/server/team/report-v3-provider";
import { teamSynthesisV3Schema } from "@/server/team/report-v3-contracts";
import { processTeamJob } from "@/server/team/worker";
import { meanEvidence, qualitativeFixture } from "./v3-fixtures";

const ports = vi.hoisted(() => ({ prompt: vi.fn(), schema: vi.fn(), construct: vi.fn(), create: vi.fn(), controlled: vi.fn() }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), readFileSync: ports.prompt }));
vi.mock("zod", async original => {
  const actual = await original<typeof import("zod")>();
  return { ...actual, z: { ...actual.z, toJSONSchema: ports.schema } };
});
vi.mock("openai", () => ({ default: class {
  responses = { create: ports.create };
  constructor(options: unknown) { ports.construct(options); }
} }));
vi.mock("@/server/team/controlled-ai-transport", () => ({
  currentControlledTeamAI: ports.controlled, currentControlledTeamClaim: () => undefined, controlledTeamModel: "gpt-5.6-sol",
}));

const sensitive = "synthetic-secret /private/operator/path qa-person@example.invalid RAW_ANSWER_CANARY";
const prompt = "Synthetic fixed prompt";
const apiError = (status: number) => new APIError(status, { message: sensitive, code: sensitive }, sensitive,
  new Headers({ authorization: sensitive, "x-request-id": sensitive }));
const failureLogs = () => vi.mocked(console.info).mock.calls.filter(c => c[1]?.event === "team_ai_stage_failure");
function expectFailure(stage: string, failure_class: string, http_status?: number, phase = "synthesis") {
  expect(failureLogs()).toEqual([["[team-ai]", { event: "team_ai_stage_failure", pipeline: "TEAM-RU-3", phase, stage,
    failure_class, ...(http_status === undefined ? {} : { http_status }) }]]);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(sensitive);
}

beforeEach(async () => {
  vi.resetAllMocks();
  ports.prompt.mockReturnValue(prompt);
  ports.schema.mockImplementation((await vi.importActual<typeof import("zod")>("zod")).z.toJSONSchema);
  ports.controlled.mockReturnValue(undefined);
  vi.stubEnv("TEAM_AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-only-not-a-real-key");
  vi.stubEnv("TEAM_AI_MODEL", ""); vi.stubEnv("OPENAI_MODEL", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN_IN_MOCK_TEST"); }));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ordinary Team AI finite diagnostic boundary", () => {
  it.each([400, 401, 403, 404, 429, 500, 503])("exports only SDK HTTP status %i and rethrows the original error", async status => {
    const error = apiError(status), counts = emptyTeamCallCounts();
    ports.create.mockRejectedValue(error);
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), counts)).rejects.toBe(error);
    expectFailure("dispatch", "http_error", status);
    expect(ports.create).toHaveBeenCalledOnce();
    expect(counts).toEqual({ synthesis_call_count: 1, report_call_count: 0, repair_call_count: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [new APIConnectionTimeoutError({ message: sensitive }), "connection_timeout"],
    [new APIConnectionError({ message: sensitive, cause: Error(sensitive) }), "connection_error"],
    [Error(sensitive), "unknown"],
    [{ name: "APIError", status: 401, message: sensitive }, "unknown"],
  ])("separates trusted connection errors from unknown or lookalike exceptions", (error, category) => {
    logTeamAIStageFailure("synthesis", "dispatch", error);
    expectFailure("dispatch", category as string);
  });

  it.each([0, 200, 399, 600, NaN])("does not report an invalid SDK status %s", status => {
    logTeamAIStageFailure("synthesis", "dispatch", apiError(status));
    expectFailure("dispatch", "unknown");
  });

  it("never reads arbitrary error message/status/body getters", () => {
    const getter = vi.fn(() => { throw Error(sensitive); });
    const error = Object.defineProperties({}, {
      message: { get: getter }, status: { get: getter }, headers: { get: getter }, error: { get: getter },
    });
    logTeamAIStageFailure("synthesis", "dispatch", error);
    expectFailure("dispatch", "unknown"); expect(getter).not.toHaveBeenCalled();
  });

  it("does not evaluate an SDK status accessor", () => {
    const error = apiError(401), getter = vi.fn(() => { throw Error(sensitive); });
    Object.defineProperty(error, "status", { get: getter });
    logTeamAIStageFailure("synthesis", "dispatch", error);
    expectFailure("dispatch", "unknown"); expect(getter).not.toHaveBeenCalled();
  });

  it("keeps a hostile prototype trap unknown without losing the finite diagnostic", () => {
    const error = new Proxy({}, { getPrototypeOf() { throw Error(sensitive); } });
    logTeamAIStageFailure("synthesis", "dispatch", error);
    expectFailure("dispatch", "unknown");
  });

  it("prompt failure records local preparation without constructing a client or dispatching", async () => {
    const error = Error(sensitive), counts = emptyTeamCallCounts();
    ports.prompt.mockImplementation(() => { throw error; });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), counts)).rejects.toBe(error);
    expectFailure("prompt_read", "local_preparation");
    expect(ports.construct).not.toHaveBeenCalled(); expect(ports.create).not.toHaveBeenCalled();
    expect(counts.synthesis_call_count).toBe(1); // Preserved helper-entry count, not an HTTP receipt.
  });

  it("serialization failure cannot be mislabeled as a provider response", async () => {
    const original = JSON.stringify, error = Error(sensitive);
    vi.spyOn(JSON, "stringify").mockImplementation(value => {
      if (value && typeof value === "object" && "groups" in value) throw error;
      return original(value);
    });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toBe(error);
    expectFailure("serialization", "local_preparation"); expect(ports.create).not.toHaveBeenCalled();
  });

  it("schema conversion failure remains before client construction and dispatch", async () => {
    const error = Error(sensitive); ports.schema.mockImplementation(() => { throw error; });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toBe(error);
    expectFailure("schema_conversion", "local_preparation");
    expect(ports.construct).not.toHaveBeenCalled(); expect(ports.create).not.toHaveBeenCalled();
  });

  it("client setup failure is distinct from an HTTP failure", async () => {
    const error = Error(sensitive); ports.construct.mockImplementation(() => { throw error; });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toBe(error);
    expectFailure("client_setup", "local_preparation"); expect(ports.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: "incomplete", output_text: sensitive },
    { status: "completed", output_text: "" },
    { status: "completed", output_text: "invalid-json " + sensitive },
  ])("records output parse failure without logging the output", async response => {
    ports.create.mockResolvedValue(response);
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toThrow();
    expectFailure("response_parse", "invalid_output"); expect(ports.create).toHaveBeenCalledOnce();
  });

  it("records schema validation failure without exporting Zod issues or response fields", async () => {
    ports.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ private: sensitive }) });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toThrow();
    expectFailure("local_validation", "invalid_output");
  });

  it("does not let a log sink failure mask the original exception", async () => {
    const error = apiError(401); ports.create.mockRejectedValue(error);
    vi.mocked(console.info).mockImplementation(() => { throw Error("log unavailable"); });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toBe(error);
    expect(ports.create).toHaveBeenCalledOnce();
  });

  it("keeps the successful request body, model, token bound and SDK no-retry settings unchanged", async () => {
    const input = qualitativeFixture(), expected = mockTeamSynthesisV3(input), counts = emptyTeamCallCounts();
    ports.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(expected) });
    expect(await synthesizeTeamTextsV3(input, counts)).toEqual(expected);
    expect(ports.create).toHaveBeenCalledExactlyOnceWith({ model: "gpt-5.6-sol", store: false, max_output_tokens: 6000,
      input: [{ role: "system", content: prompt }, { role: "user", content: `<UNTRUSTED_TEAM_EVIDENCE>\n${JSON.stringify(input)}\n</UNTRUSTED_TEAM_EVIDENCE>` }],
      text: { format: { type: "json_schema", name: "team_synthesis_ru_3", strict: true, schema: z.toJSONSchema(teamSynthesisV3Schema) } },
    });
    expect(ports.construct).toHaveBeenCalledExactlyOnceWith({ apiKey: "synthetic-only-not-a-real-key", maxRetries: 0,
      timeout: 180000, fetch: expect.any(Function) });
    expect(failureLogs()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["report", "repair", "report_repair"] as const)("keeps %s failures phase-specific without another call", async phase => {
    const error = apiError(400), counts = emptyTeamCallCounts(); ports.create.mockRejectedValue(error);
    const run = phase === "report" ? generateTeamReportV3(meanEvidence(), mockTeamSynthesisV3(qualitativeFixture()), counts)
      : repairV3Fields([{ path: "summary", value: "synthetic generated field" }], counts, phase === "report_repair");
    await expect(run).rejects.toBe(error);
    expectFailure("dispatch", "http_error", 400, phase); expect(ports.create).toHaveBeenCalledOnce();
    expect(ports.create.mock.calls[0][0].max_output_tokens).toBe(phase === "report" ? 14000 : 6000);
  });

  it("does not add ordinary diagnostics or a normal SDK client to the controlled transport path", async () => {
    const error = apiError(401), create = vi.fn().mockRejectedValue(error);
    ports.controlled.mockReturnValue({ create });
    await expect(synthesizeTeamTextsV3(qualitativeFixture(), emptyTeamCallCounts())).rejects.toBe(error);
    expect(create).toHaveBeenCalledOnce(); expect(ports.construct).not.toHaveBeenCalled();
    expect(ports.create).not.toHaveBeenCalled(); expect(failureLogs()).toEqual([]);
  });

  it("preserves worker failure code/nonretryability and does not publish or store after one mocked synthesis API error", async () => {
    ports.create.mockRejectedValue(apiError(401));
    const input = qualitativeFixture();
    const rpc = vi.fn(async (name: string) => ({ data: name === "prepare_team_report_job"
      ? { status: "generating", pipeline_version: "TEAM-RU-3", provider_mode: "openai", qualitative_input: input, report_input: meanEvidence() }
      : name === "get_team_synthesis_privacy_corpus" ? { threshold: 32, answers: [], identifiers: [] } : "completed", error: null }));
    expect(await processTeamJob({ id: "synthetic-job", kind: "team_ai_report", lease_token: "synthetic-lease", attempts: 1 }, rpc)).toBe("failed");
    expect(ports.create).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.map(c => c[0])).toEqual(["prepare_team_report_job", "get_team_synthesis_privacy_corpus", "fail_team_job"]);
    expect(rpc).toHaveBeenLastCalledWith("fail_team_job", { p_job_id: "synthetic-job", p_lease_token: "synthetic-lease", p_error_code: "team_processing_failed", p_retryable: false });
    expectFailure("dispatch", "http_error", 401);
    expect(vi.mocked(console.info).mock.calls.find(c => c[1]?.event === "team_ai_call_counts")?.[1]).toEqual({ event: "team_ai_call_counts", synthesis_call_count: 1, repair_call_count: 0, report_call_count: 0 });
  });
});
