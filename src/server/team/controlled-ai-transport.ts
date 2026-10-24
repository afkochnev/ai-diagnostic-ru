import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const controlledTeamModel = "gpt-5.6-sol";
export const controlledTeamRequestBytes = 131072;
export const controlledTeamStageTokens = { model_get: 0, synthesis: 6000, synthesis_repair: 6000, main_report: 14000, report_repair: 6000 } as const;
export type ControlledTeamStage = keyof typeof controlledTeamStageTokens;
export type ControlledTeamRpc = (name: string, args: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;
export type ControlledTeamClaim = {
  run_id: string; team_id: string; report_id: string | null; source_fingerprint: string;
  job_id: string; kind: "team_aggregate" | "team_ai_report"; lease_token: string;
  lease_expires_at: string; deadline_at: string | null; server_now: string;
  pipeline_version: string; provider_mode: string | null; attempts: number;
  window_id?: string | null; approved_plan_hash?: string | null;
};
type ResponseBody = { status: string; model: string; id: string; output_text: string; usage: { input_tokens: number; output_tokens: number } };
type SafeMetadata = { model?: string; input_tokens?: number; output_tokens?: number; response_id?: string; http_status: number; elapsed_ms: number; request_bytes: number };
const current = new AsyncLocalStorage<ControlledTeamAITransport>();
const claimedScope = new AsyncLocalStorage<ControlledTeamClaim>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () => { throw new Error("controlled_team_ai_rejected"); };

export function validateControlledClaim(value: unknown): ControlledTeamClaim {
  const c = value as ControlledTeamClaim;
  if (!c || ![c.run_id, c.team_id, c.job_id, c.lease_token].every(id => typeof id === "string" && uuid.test(id)) || !/^[a-f0-9]{64}$/.test(c.source_fingerprint) || !["team_aggregate", "team_ai_report"].includes(c.kind) || c.attempts !== 1 || !Number.isFinite(Date.parse(c.server_now)) || !Number.isFinite(Date.parse(c.lease_expires_at))) fail();
  if (c.kind === "team_ai_report" && (!c.report_id || !uuid.test(c.report_id) || c.pipeline_version !== "TEAM-RU-3" || c.provider_mode !== "openai" || !c.deadline_at)) fail();
  if (c.window_id != null && (!uuid.test(c.window_id) || !/^[a-f0-9]{64}$/.test(c.approved_plan_hash ?? ""))) fail();
  return c;
}

export class ControlledTeamAITransport {
  readonly claim: ControlledTeamClaim;
  private deadline: number;
  private modelPassed = false;
  private readonly stages = new Set<ControlledTeamStage>();
  private readonly reservedStages = new Set<ControlledTeamStage>();
  private modelHTTPStarted=0;
  private responsesHTTPStarted=0;
  private readonly receipts: {stage:ControlledTeamStage;status:string;metadata:SafeMetadata}[]=[];
  private readonly monotonic: () => number;
  constructor(private readonly options: { claim: ControlledTeamClaim; rpc: ControlledTeamRpc; fetch: typeof fetch; apiKey: string; signal?: AbortSignal; monotonic?: () => number; claimRoundTripMs?: number }) {
    this.claim = validateControlledClaim(options.claim);
    this.monotonic = options.monotonic ?? (() => performance.now());
    if (this.claim.kind !== "team_ai_report" || !options.apiKey.trim() || typeof options.fetch !== "function") fail();
    this.deadline = this.serverDeadline(this.claim, options.claimRoundTripMs ?? 0);
  }
  private serverDeadline(c: { deadline_at: string | null; server_now: string; lease_expires_at: string }, roundTrip: number) {
    const server = Date.parse(c.server_now), expiry = Date.parse(c.deadline_at ?? ""), lease = Date.parse(c.lease_expires_at);
    if (![server, expiry, lease, roundTrip].every(Number.isFinite) || roundTrip < 0 || expiry - server > 540000 || expiry > lease - 60000) fail();
    // Subtract the entire observed RPC round trip, plus skew margin. A later
    // reservation may shorten this monotonic deadline, never extend it.
    return this.monotonic() + Math.min(expiry - server, lease - server - 60000) - roundTrip - 2000;
  }
  private remaining() { if (this.options.signal?.aborted) fail(); return this.deadline - this.monotonic(); }
  /** A work RPC can consume its full 30s timeout before bounded cleanup starts.
   * Keep that work inside the generation deadline; the persisted lease already
   * retains a further 60s cushion which is never used to admit new work. */
  assertWorkWindow() {
    if (this.remaining() <= 30000) fail();
  }
  private async complete(reservation: string, status: "succeeded" | "failed" | "unknown", metadata: SafeMetadata) {
    const r = await this.options.rpc("complete_controlled_team_effect", { p_reservation_id: reservation, p_status: status, p_provider_reference: metadata.response_id ?? null, p_metadata: metadata });
    if (r.error || (r.data as { status?: string } | null)?.status !== status) throw new Error("controlled_team_receipt_unconfirmed");
  }
  safeAudit() {
    return {
      modelHTTPStarted: this.modelHTTPStarted,
      responsesHTTPStarted: this.responsesHTTPStarted,
      attemptedStages: [...this.stages],
      reservedStages: [...this.reservedStages],
      receipts: structuredClone(this.receipts),
      automaticRetries: 0,
    };
  }
  private async dispatch(stage: ControlledTeamStage, body?: Record<string, unknown>): Promise<unknown> {
    if (this.stages.has(stage) || stage !== "model_get" && !this.modelPassed || this.remaining() <= 10000) fail();
    const text = body ? JSON.stringify(body) : undefined, bytes = text === undefined ? 0 : Buffer.byteLength(text);
    if (bytes > controlledTeamRequestBytes) fail();
    if (stage !== "model_get" && (!body || body.model !== controlledTeamModel || body.store !== false || body.max_output_tokens !== controlledTeamStageTokens[stage] || body.service_tier !== "default" || (body.text as { format?: { type?: string; strict?: boolean } } | undefined)?.format?.type !== "json_schema" || (body.text as { format?: { strict?: boolean } }).format?.strict !== true || Object.keys(body).some(key => !["model", "store", "max_output_tokens", "input", "text", "service_tier"].includes(key)))) fail();
    this.stages.add(stage); // Never release an uncertain local reservation.
    const reserveStarted = this.monotonic();
    const r = await this.options.rpc(this.claim.window_id ? "reserve_controlled_team_window_ai_call" : "reserve_controlled_team_ai_call", { p_run_id: this.claim.run_id, ...(this.claim.window_id ? { p_window_id: this.claim.window_id } : {}), p_job_id: this.claim.job_id, p_lease_token: this.claim.lease_token, p_stage: stage, p_request_bytes: bytes, p_max_output_tokens: controlledTeamStageTokens[stage] });
    if (r.error) fail();
    const reservation = r.data as ControlledTeamClaim & { reservation_id: string; stage: ControlledTeamStage; model: string };
    if (!reservation || !uuid.test(reservation.reservation_id) || reservation.stage !== stage || reservation.model !== controlledTeamModel || ["run_id", "team_id", "report_id", "source_fingerprint"].some(key => reservation[key as keyof ControlledTeamClaim] !== this.claim[key as keyof ControlledTeamClaim])) fail();
    if ((reservation.window_id ?? null) !== (this.claim.window_id ?? null) || (this.claim.window_id && reservation.approved_plan_hash !== this.claim.approved_plan_hash)) fail();
    this.reservedStages.add(stage);
    this.deadline = Math.min(this.deadline, this.serverDeadline(reservation, this.monotonic() - reserveStarted));
    const timeout = Math.min(stage === "model_get" ? 20000 : 180000, this.remaining() - 10000);
    if (timeout <= 0) fail();
    const signal = this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(Math.max(1, Math.floor(timeout)))]) : AbortSignal.timeout(Math.max(1, Math.floor(timeout)));
    const started = this.monotonic();
    let response: Response;
    try {
      // Native fetch is invoked exactly once. There is no SDK retry/poll layer,
      // and redirects cannot create an unreserved additional HTTP request.
      if(stage==="model_get")this.modelHTTPStarted++;else this.responsesHTTPStarted++;
      response = await this.options.fetch(stage === "model_get" ? `https://api.openai.com/v1/models/${controlledTeamModel}` : "https://api.openai.com/v1/responses", { method: stage === "model_get" ? "GET" : "POST", headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" }, ...(text ? { body: text } : {}), redirect: "error", signal });
    } catch {
      await this.complete(reservation.reservation_id, "unknown", { http_status: 0, elapsed_ms: Math.ceil(this.monotonic() - started), request_bytes: bytes });
      this.receipts.push({stage,status:"unknown",metadata:{http_status:0,elapsed_ms:Math.ceil(this.monotonic()-started),request_bytes:bytes}});
      throw new Error("controlled_team_provider_unknown");
    }
    const metadata: SafeMetadata = { http_status: response.status, elapsed_ms: Math.ceil(this.monotonic() - started), request_bytes: bytes };
    if (!response.ok) {
      await this.complete(reservation.reservation_id, "failed", metadata);
      this.receipts.push({stage,status:"failed",metadata});
      throw new Error("controlled_team_provider_failed");
    }
    let parsed: unknown;
    try {
      const value = await response.text();
      if (Buffer.byteLength(value) > 2097152) fail();
      parsed = JSON.parse(value);
      if (this.remaining() <= 0) fail();
      if (stage === "model_get") {
        if ((parsed as { id?: string })?.id !== controlledTeamModel) fail();
        this.modelPassed = true;
      } else {
        const p = parsed as ResponseBody & { output?: { content?: { type?: string; text?: string }[] }[]; error?: unknown; incomplete_details?: unknown };
        if (p.status !== "completed" || p.model !== controlledTeamModel || p.error || p.incomplete_details || !/^resp_[A-Za-z0-9_-]{1,150}$/.test(p.id ?? "") || !Number.isInteger(p.usage?.input_tokens) || p.usage.input_tokens < 1 || p.usage.input_tokens > bytes || !Number.isInteger(p.usage.output_tokens) || p.usage.output_tokens < 1 || p.usage.output_tokens > controlledTeamStageTokens[stage]) fail();
        const output = p.output?.flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text ?? "").join("") ?? "";
        if (!output) fail();
        parsed = { ...p, output_text: output };
        Object.assign(metadata, { model: p.model, response_id: p.id, input_tokens: p.usage.input_tokens, output_tokens: p.usage.output_tokens });
      }
    } catch {
      await this.complete(reservation.reservation_id, "failed", metadata);
      this.receipts.push({stage,status:"failed",metadata});
      throw new Error("controlled_team_output_rejected");
    }
    await this.complete(reservation.reservation_id, "succeeded", metadata);
    this.receipts.push({stage,status:"succeeded",metadata});
    // The receipt RPC itself may have consumed its full timeout. Never pass a
    // now-expired output to synthesis storage/publication or admit a next stage.
    if (this.remaining() <= 0) fail();
    return parsed;
  }
  async preflightModel() { await this.dispatch("model_get"); }
  async create(stage: Exclude<ControlledTeamStage, "model_get">, body: Record<string, unknown>) { return await this.dispatch(stage, { ...body, service_tier: "default" }) as ResponseBody; }
}

export function currentControlledTeamAI() { return current.getStore(); }
export function withControlledTeamAI<T>(transport: ControlledTeamAITransport, action: () => Promise<T>) { return current.run(transport, action); }
export function currentControlledTeamClaim() { return claimedScope.getStore() ?? current.getStore()?.claim; }
export function withControlledTeamClaim<T>(claim: ControlledTeamClaim, action: () => Promise<T>) { return claimedScope.run(validateControlledClaim(claim), action); }
