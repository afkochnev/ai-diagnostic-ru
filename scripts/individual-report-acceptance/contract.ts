import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";

const ExactDecimal = Decimal.clone({ minE: -9e15, maxE: 9e15 });

export const ROLES = ["facts", "depth", "boundary"] as const;
export const SECTIONS = [
  "summary", "main_diagnosis", "manageability_index_text", "strengths",
  "key_problem_zones", "growth_constraint", "implementation_risks", "first_actions",
  "plan_30_days", "plan_60_days", "plan_90_days", "next_step",
] as const;
export const CASES = ["sparse-contrast", "explicit-existing-controls"] as const;
export const SCHEMA_SHA256 = "ff05cd97c3392294b0ee027188dcf814d5f8a49b5dac1a5a700a4aaa567318de";
export const POLICY = "individual-fact-boundary/v1";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const text = z.string().trim().min(1).max(8000);
const verdict = z.enum(["PASS", "FAIL", "HOLD"]);
const role = z.enum(ROLES);
const section = z.enum(SECTIONS);
const artifact = z.strictObject({ path: z.string().min(1).max(240), sha256: hash });
const reviewRef = artifact.extend({
  role,
  format: z.enum(["native/v1", "legacy-facts/v1", "legacy-depth/v1", "legacy-boundary/v1"]),
});
export const planSchema = z.strictObject({
  format: z.literal("individual-acceptance-plan/v1"),
  policy: z.literal(POLICY),
  candidate: z.strictObject({
    source_commit: commit, prompt_version: z.literal("RU-1.4"),
    prompt_sha256: hash, schema_sha256: z.literal(SCHEMA_SHA256), model: z.literal("gpt-5.6-sol"),
  }),
  prompt: artifact,
  schema: artifact,
  // These declarations need operator verification. They are not identity authentication.
  reviewers: z.strictObject({ facts: id, depth: id, boundary: id }),
  review_inventory_complete: z.boolean(),
  cases: z.array(z.strictObject({
    case_id: z.enum(CASES), input: artifact, raw: artifact.nullable(),
    reviews: z.array(reviewRef).max(60),
    review_heads: z.strictObject({ facts: hash.nullable(), depth: hash.nullable(), boundary: hash.nullable() }),
  })).length(2),
});
export type Plan = z.infer<typeof planSchema>;
export const subjectSchema = z.strictObject({
  context_sha256: hash, case_id: z.enum(CASES), raw_sha256: hash,
  output_sha256: hash, input_sha256: hash, prompt_sha256: hash, schema_sha256: hash,
  candidate_source_commit: commit, model: z.string().min(1).max(80),
});
export const reviewSchema = z.strictObject({
  format: z.literal("individual-acceptance-review/v1"),
  policy: z.literal(POLICY), role, reviewer_id: id, review_id: id,
  revision: z.number().int().min(1).max(1000), supersedes: hash.nullable(),
  subject: subjectSchema, verdict,
  sections: z.array(z.strictObject({ section, verdict, rationale: text })).length(12),
  findings: z.array(z.strictObject({
    finding_id: id, section, report_pointer: z.string().min(1).max(240), quote: text,
    input_pointers: z.array(z.string().min(1).max(240)).min(1).max(32), reason: text,
  })).max(200),
});
export type Review = z.infer<typeof reviewSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Role = typeof ROLES[number];
export type Artifact = z.infer<typeof artifact>;

export class EvidenceError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(object[k])}`).join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new EvidenceError("INVALID_JSON_VALUE");
  return result;
}
export function parsePlan(value: unknown): Plan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceError("PLAN_SCHEMA_INVALID");
  const plan = parsed.data;
  if (new Set(plan.cases.map(c => c.case_id)).size !== CASES.length)
    throw new EvidenceError("CASE_INVENTORY_INVALID");
  if (new Set(Object.values(plan.reviewers)).size !== ROLES.length)
    throw new EvidenceError("REVIEWER_ASSIGNMENTS_NOT_DISTINCT");
  if (plan.prompt.sha256 !== plan.candidate.prompt_sha256 || plan.schema.sha256 !== SCHEMA_SHA256)
    throw new EvidenceError("CANDIDATE_ARTIFACT_MISMATCH");
  return plan;
}
export function parseReview(value: unknown): Review {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceError("REVIEW_SCHEMA_INVALID");
  if (new Set(parsed.data.sections.map(s => s.section)).size !== SECTIONS.length)
    throw new EvidenceError("REVIEW_COVERAGE_INVALID");
  if (new Set(parsed.data.findings.map(f => f.finding_id)).size !== parsed.data.findings.length)
    throw new EvidenceError("FINDING_IDS_NOT_UNIQUE");
  return parsed.data;
}
// Exclude review history to avoid circular hashes. The externally pinned complete plan
// separately binds the inventory and explicit heads, including subsequent negative reviews.
export function contextHash(plan: Plan): string {
  return sha256(canonicalJson({
    policy: plan.policy, candidate: plan.candidate, reviewers: plan.reviewers,
    cases: [...plan.cases].sort((a, b) => a.case_id.localeCompare(b.case_id)).map(c => ({
      case_id: c.case_id, input_sha256: c.input.sha256, raw_sha256: c.raw?.sha256 ?? null,
    })),
  }));
}

// JSON.parse alone discards duplicate keys. Scan first and bound nesting/node count.
// Check number tokens for decimal value loss before native decoding; no eval or reviver.
export function parseJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 1024 * 1024) throw new EvidenceError("JSON_TOO_LARGE");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new EvidenceError("JSON_UTF8_INVALID"); }
  let pos = 0;
  let nodes = 0;
  const bad = (): never => { throw new EvidenceError("JSON_INVALID"); };
  const space = () => { while (/\s/.test(source[pos] ?? "") && pos < source.length) pos++; };
  const string = (): string => {
    const start = pos++;
    while (pos < source.length) {
      const char = source[pos++];
      if (char === "\\") { pos++; continue; }
      if (char === '"') {
        try { return JSON.parse(source.slice(start, pos)) as string; } catch { return bad(); }
      }
    }
    return bad();
  };
  const value = (depth: number): void => {
    if (depth > 40 || ++nodes > 40000) throw new EvidenceError("JSON_COMPLEXITY_LIMIT");
    space();
    const char = source[pos];
    if (char === '"') { string(); return; }
    if (char === "{" || char === "[") {
      pos++; space();
      const closing = char === "{" ? "}" : "]";
      const keys = new Set<string>();
      if (source[pos] === closing) { pos++; return; }
      while (pos < source.length) {
        if (char === "{") {
          if (source[pos] !== '"') bad();
          const key = string();
          if (keys.has(key)) throw new EvidenceError("JSON_DUPLICATE_KEY");
          keys.add(key); space();
          if (source[pos++] !== ":") bad();
        }
        value(depth + 1); space();
        if (source[pos] === closing) { pos++; return; }
        if (source[pos++] !== ",") bad();
        space();
      }
      return bad();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(pos));
    if (!match) bad();
    const token = match![0];
    if (/^-?\d/.test(token)) {
      const native = Number(token);
      if (!Number.isFinite(native)) bad();
      // Inspect zero mantissas directly: Decimal also has an exponent underflow limit.
      const lossy = native === 0
        ? /[1-9]/.test(token.split(/[eE]/, 1)[0])
        : !new ExactDecimal(token).equals(new ExactDecimal(String(native)));
      if (lossy) throw new EvidenceError("JSON_NUMBER_PRECISION_LOSS");
    }
    pos += token.length;
  };
  value(0); space();
  if (pos !== source.length) bad();
  try {
    const result: unknown = JSON.parse(source);
    const finite = (v: unknown): boolean => typeof v === "number" ? Number.isFinite(v)
      : Array.isArray(v) ? v.every(finite)
      : v !== null && typeof v === "object" ? Object.values(v).every(finite) : true;
    if (!finite(result)) bad();
    return result;
  } catch { return bad(); }
}

export function pointer(value: unknown, path: string): unknown {
  if (!path.startsWith("/") || /~(?![01])/.test(path)) throw new EvidenceError("POINTER_INVALID");
  let cursor = value;
  for (const token of path.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, key))
      throw new EvidenceError("POINTER_NOT_FOUND");
    if (Array.isArray(cursor) && !/^(0|[1-9]\d*)$/.test(key)) throw new EvidenceError("POINTER_INVALID");
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}
